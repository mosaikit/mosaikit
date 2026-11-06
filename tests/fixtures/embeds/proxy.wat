;; Logic of the test plugins of spec 22 (embedded pages): it forwards the `args` of the call to the host as a request
;; (`{ "op": "db.query", "req": { ... } }`) and returns the answer, so a page can read its plugin's data with the rights
;; of the ticket. Same module as `proxy_wasm` in crates/kernel/tests/public_commands.rs.
;; Build proxy.wasm from it with the `wat` crate (`wat::parse_file`) or `wat2wasm`.
(module
  (import "msk" "host_call" (func $host_call (param i32 i32) (result i32)))
  (import "msk" "host_read" (func $host_read (param i32)))
  (memory (export "memory") 2)
  (data (i32.const 16) "\"args\":")
  (data (i32.const 32) ",\"ctx\":")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func $find (param $from i32) (param $to i32) (param $n i32) (result i32)
    (local $i i32) (local $k i32)
    (local.set $i (local.get $from))
    (block $done (loop $outer
      (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 7)) (local.get $to)))
      (local.set $k (i32.const 0))
      (block $miss (loop $inner
        (br_if $miss (i32.ne (i32.load8_u (i32.add (local.get $i) (local.get $k)))
                             (i32.load8_u (i32.add (local.get $n) (local.get $k)))))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (if (i32.eq (local.get $k) (i32.const 7)) (then (return (local.get $i))))
        (br $inner)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $outer)))
    (i32.const -1))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (local $s i32) (local $e i32) (local $n i32)
    (local.set $s (i32.add (call $find (local.get $ptr) (i32.add (local.get $ptr) (local.get $len)) (i32.const 16)) (i32.const 7)))
    (local.set $e (call $find (local.get $s) (i32.add (local.get $ptr) (local.get $len)) (i32.const 32)))
    (local.set $n (call $host_call (local.get $s) (i32.sub (local.get $e) (local.get $s))))
    (call $host_read (i32.const 32768))
    (i64.or (i64.shl (i64.const 32768) (i64.const 32)) (i64.extend_i32_u (local.get $n))))
)
