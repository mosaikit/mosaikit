use super::*;

/// Guest minimale in WAT che implementa l'ABI a mano.
/// - msk_call: chiama host_call con la richiesta fissa {"op":"echo","req":1},
///   copia la risposta in memoria e la restituisce;
/// - loop: se il messaggio in ingresso inizia con `"l` entra in un ciclo infinito;
/// - grow: se inizia con `"g` prova a crescere di 2000 pagine (128 MB).
const GUEST: &str = r#"
(module
  (import "msk" "host_call" (func $host_call (param i32 i32) (result i32)))
  (import "msk" "host_read" (func $host_read (param i32)))
  (import "msk" "log" (func $log (param i32 i32)))
  (memory (export "memory") 1)
  (data (i32.const 16) "{\"op\":\"echo\",\"req\":1}")
  (data (i32.const 64) "ciao")
  (global $bump (mut i32) (i32.const 1024))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32)
    (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len)))
    (local.get $p))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (local $n i32)
    (local $out i32)
    (if (i32.eq (i32.load8_u offset=1 (local.get $ptr)) (i32.const 108))
      (then (loop $l (br $l))))
    (if (i32.eq (i32.load8_u offset=1 (local.get $ptr)) (i32.const 103))
      (then (drop (memory.grow (i32.const 2000)))))
    (call $log (i32.const 64) (i32.const 4))
    (local.set $n (call $host_call (i32.const 16) (i32.const 21)))
    (local.set $out (i32.const 4096))
    (call $host_read (local.get $out))
    (i64.or
      (i64.shl (i64.extend_i32_u (local.get $out)) (i64.const 32))
      (i64.extend_i32_u (local.get $n))))
)
"#;

#[derive(Default)]
struct TestHost {
    calls: Vec<String>,
    logs: Vec<String>,
}

impl Host for TestHost {
    fn call(&mut self, op: &str, req: &Value) -> std::result::Result<Value, String> {
        self.calls.push(op.to_string());
        if op == "echo" {
            Ok(json!({ "echo": req }))
        } else {
            Err("sconosciuta".into())
        }
    }
    fn log(&mut self, msg: &str) {
        self.logs.push(msg.to_string());
    }
}

fn engine() -> Engine {
    Engine::new(Limits { fuel: 5_000_000, memory_bytes: 16 << 20, max_message: 1 << 20 })
}

#[test]
fn chiamata_con_host_call_e_log() {
    let e = engine();
    let m = e.compile(&wat::parse_str(GUEST).unwrap()).unwrap();
    let (res, host) = e.call(&m, &json!("x"), TestHost::default());
    assert_eq!(res.unwrap(), json!({ "ok": { "echo": 1 } }));
    assert_eq!(host.calls, vec!["echo"]);
    assert_eq!(host.logs, vec!["ciao"]);
    // istanza nuova a ogni chiamata: lo stato del guest non sopravvive
    let (res2, _) = e.call(&m, &json!("x"), TestHost::default());
    assert!(res2.is_ok());
}

#[test]
fn ciclo_infinito_fermato_dal_fuel() {
    let e = engine();
    let m = e.compile(&wat::parse_str(GUEST).unwrap()).unwrap();
    let (res, _) = e.call(&m, &json!("loop"), TestHost::default());
    assert!(matches!(res, Err(RuntimeError::OutOfFuel)), "{res:?}");
}

#[test]
fn memoria_oltre_il_limite_negata() {
    let e = engine();
    let m = e.compile(&wat::parse_str(GUEST).unwrap()).unwrap();
    // memory.grow oltre il limite fallisce (ritorna -1): il guest prosegue normalmente
    let (res, _) = e.call(&m, &json!("grow"), TestHost::default());
    assert!(res.is_ok(), "{res:?}");
}

#[test]
fn moduli_non_conformi_rifiutati() {
    let e = engine();
    assert!(matches!(e.compile(b"non wasm"), Err(RuntimeError::Invalid(_))));
    let no_exports = wat::parse_str("(module (memory (export \"memory\") 1))").unwrap();
    assert!(matches!(e.compile(&no_exports), Err(RuntimeError::Invalid(_))));
    let wasi = wat::parse_str(
        r#"(module (import "wasi_snapshot_preview1" "fd_write" (func (param i32 i32 i32 i32) (result i32)))
             (memory (export "memory") 1)
             (func (export "msk_alloc") (param i32) (result i32) i32.const 0)
             (func (export "msk_call") (param i32 i32) (result i64) i64.const 0))"#,
    )
    .unwrap();
    let err = e.compile(&wasi).err().unwrap().to_string();
    assert!(err.contains("import non consentito"), "{err}");
}
