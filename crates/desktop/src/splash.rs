//! Splash window: icon, name and version of the product, spinner and current phase.
//!
//! It appears only if the start takes more than half a second (typically the first start,
//! or with embedded PostgreSQL) and closes when the app is ready. Drawn with
//! GDI on an in-memory buffer; it lives on the thread of the icon, which dispatches its messages.

#![allow(unsafe_code)] // Win32 API: window, timer and GDI drawing

use std::cell::RefCell;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush, DeleteDC,
    DeleteObject, DrawTextW, Ellipse, EndPaint, FillRect, FrameRect, GetStockObject, InvalidateRect,
    SelectObject, SetBkMode, SetTextColor, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET,
    DEFAULT_PITCH, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_SINGLELINE, FF_SWISS, FW_NORMAL, FW_SEMIBOLD,
    HDC, HFONT, NULL_PEN, OUT_DEFAULT_PRECIS, PAINTSTRUCT, SRCCOPY, TRANSPARENT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyIcon, DestroyWindow, DrawIconEx, GetSystemMetrics, KillTimer,
    LoadCursorW, LoadImageW, RegisterClassW, SetTimer, SetWindowPos, DI_NORMAL, HICON, HWND_TOPMOST,
    IDC_ARROW, IMAGE_ICON, LR_LOADFROMFILE, SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    WM_ERASEBKGND, WM_PAINT, WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::App;

const W: i32 = 400;
const H: i32 = 190;
const TIMER: usize = 1;

struct Splash {
    hwnd: HWND,
    name: String,
    version: String,
    phase: String,
    step: u32,
    icon: HICON,
    colors: Colors,
    title_font: HFONT,
    text_font: HFONT,
    small_font: HFONT,
}

#[derive(Clone, Copy)]
struct Colors {
    bg: COLORREF,
    line: COLORREF,
    fg: COLORREF,
    dim: COLORREF,
    acc: COLORREF,
}

thread_local! {
    static SPLASH: RefCell<Option<Splash>> = const { RefCell::new(None) };
    /// last phase received (even before the window appears)
    static PHASE: RefCell<String> = RefCell::new(String::from("Starting"));
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    r as u32 | (g as u32) << 8 | (b as u32) << 16
}

fn hex(v: Option<&String>, default: COLORREF) -> COLORREF {
    let Some(h) = v.and_then(|v| v.strip_prefix('#')).filter(|h| h.len() >= 6) else { return default };
    let p = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    match (p(0), p(2), p(4)) {
        (Some(r), Some(g), Some(b)) => rgb(r, g, b),
        _ => default,
    }
}

fn mix(a: COLORREF, b: COLORREF, t: f32) -> COLORREF {
    let ch = |c: COLORREF, s: u32| ((c >> s) & 0xff) as f32;
    let m = |s: u32| ((ch(a, s) * (1.0 - t) + ch(b, s) * t).round() as u32) << s;
    m(0) | m(8) | m(16)
}

fn font(height: i32, weight: u32) -> HFONT {
    let face = wide("Segoe UI");
    // SAFETY: numeric parameters and zero-terminated font name.
    unsafe {
        CreateFontW(
            height,
            0,
            0,
            0,
            weight as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            OUT_DEFAULT_PRECIS as u32,
            CLIP_DEFAULT_PRECIS as u32,
            CLEARTYPE_QUALITY as u32,
            (DEFAULT_PITCH | FF_SWISS) as u32,
            face.as_ptr(),
        )
    }
}

fn text(hdc: HDC, f: HFONT, color: COLORREF, s: &str, mut r: RECT) {
    let w: Vec<u16> = s.encode_utf16().collect();
    // SAFETY: hdc valid while drawing; text and rectangle live until the return.
    unsafe {
        SelectObject(hdc, f);
        SetTextColor(hdc, color);
        DrawTextW(
            hdc,
            w.as_ptr(),
            w.len() as i32,
            &mut r,
            DT_LEFT | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS,
        );
    }
}

fn paint(s: &Splash, hdc: HDC) {
    let c = s.colors;
    // SAFETY: GDI on an in-memory DC created and destroyed here; the objects created are deleted.
    unsafe {
        let mem = CreateCompatibleDC(hdc);
        let bmp = CreateCompatibleBitmap(hdc, W, H);
        let old = SelectObject(mem, bmp);
        let all = RECT { left: 0, top: 0, right: W, bottom: H };
        let bg = CreateSolidBrush(c.bg);
        FillRect(mem, &all, bg);
        DeleteObject(bg);
        let line = CreateSolidBrush(c.line);
        FrameRect(mem, &all, line);
        DeleteObject(line);
        // accent bar at the top
        let acc = CreateSolidBrush(c.acc);
        FillRect(mem, &RECT { left: 0, top: 0, right: W, bottom: 3 }, acc);
        DeleteObject(acc);
        if !s.icon.is_null() {
            DrawIconEx(mem, 28, 34, s.icon, 48, 48, 0, null_mut(), DI_NORMAL);
        }
        SetBkMode(mem, TRANSPARENT as i32);
        text(mem, s.title_font, c.fg, &s.name, RECT { left: 92, top: 32, right: W - 24, bottom: 64 });
        text(
            mem,
            s.small_font,
            c.dim,
            &format!("versione {}", s.version),
            RECT { left: 93, top: 64, right: W - 24, bottom: 84 },
        );
        // spinner: eight dots, the tail fades into the background
        let (cx, cy, rad) = (52.0f32, 130.0f32, 13.0f32);
        SelectObject(mem, GetStockObject(NULL_PEN));
        for i in 0..8u32 {
            let age = (s.step + 8 - i) % 8;
            let t = 1.0 - age as f32 / 8.0;
            let a = std::f32::consts::TAU * i as f32 / 8.0 - std::f32::consts::FRAC_PI_2;
            let (x, y) = (cx + rad * a.cos(), cy + rad * a.sin());
            let b = CreateSolidBrush(mix(c.bg, c.acc, 0.15 + 0.85 * t));
            let o = SelectObject(mem, b);
            let d = 2.2 + 1.6 * t;
            Ellipse(mem, (x - d) as i32, (y - d) as i32, (x + d) as i32 + 1, (y + d) as i32 + 1);
            SelectObject(mem, o);
            DeleteObject(b);
        }
        text(
            mem,
            s.text_font,
            c.fg,
            &format!("{}…", s.phase),
            RECT { left: 92, top: 118, right: W - 24, bottom: 142 },
        );
        text(
            mem,
            s.small_font,
            c.dim,
            "The first start may take a few seconds",
            RECT { left: 92, top: 146, right: W - 24, bottom: 166 },
        );
        BitBlt(hdc, 0, 0, W, H, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_ERASEBKGND => 1,
        WM_TIMER => {
            SPLASH.with(|s| {
                if let Some(s) = s.borrow_mut().as_mut() {
                    s.step = (s.step + 1) % 8;
                }
            });
            InvalidateRect(hwnd, null_mut(), 0);
            0
        }
        WM_PAINT => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut ps);
            SPLASH.with(|s| {
                if let Some(s) = s.borrow().as_ref() {
                    paint(s, hdc);
                }
            });
            EndPaint(hwnd, &ps);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// Shows the window (if it is not open yet).
pub fn show(app: &App) {
    if SPLASH.with(|s| s.borrow().is_some()) {
        return;
    }
    let col = |k: &str| app.colors.get(k);
    let colors = Colors {
        bg: hex(col("bg"), rgb(0x0b, 0x0c, 0x0f)),
        line: hex(col("line"), rgb(0x2a, 0x2e, 0x37)),
        fg: hex(col("fg"), rgb(0xec, 0xe7, 0xdb)),
        dim: hex(col("dim"), rgb(0x8f, 0x88, 0x7a)),
        acc: hex(col("accent"), rgb(0xf0, 0xb2, 0x3e)),
    };
    let class = wide("MosaikitSplash");
    let title = wide(&app.name);
    // SAFETY: registration of the class and creation of the window on the current thread;
    // the strings live until the return; the icon is loaded from a file and freed in `close`.
    unsafe {
        let hinst = GetModuleHandleW(null_mut());
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinst,
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: null_mut(),
            lpszMenuName: null_mut(),
            lpszClassName: class.as_ptr(),
        };
        RegisterClassW(&wc); // already registered: harmless error
        let x = (GetSystemMetrics(SM_CXSCREEN) - W) / 2;
        let y = (GetSystemMetrics(SM_CYSCREEN) - H) / 2;
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            x,
            y,
            W,
            H,
            null_mut(),
            null_mut(),
            hinst,
            null_mut(),
        );
        if hwnd.is_null() {
            tracing::warn!("splash window not created: {}", std::io::Error::last_os_error());
            return;
        }
        tracing::info!("splash window shown");
        let path = wide(&app.icon_file.to_string_lossy());
        let icon = LoadImageW(null_mut(), path.as_ptr(), IMAGE_ICON, 48, 48, LR_LOADFROMFILE) as HICON;
        let phase = PHASE.with(|p| p.borrow().clone());
        SPLASH.with(|s| {
            *s.borrow_mut() = Some(Splash {
                hwnd,
                name: app.name.clone(),
                version: app.version.clone(),
                phase,
                step: 0,
                icon,
                colors,
                title_font: font(-26, FW_SEMIBOLD),
                text_font: font(-15, FW_NORMAL),
                small_font: font(-13, FW_NORMAL),
            })
        });
        SetTimer(hwnd, TIMER, 90, None);
        // SetWindowPos and not ShowWindow: the first ShowWindow of the process uses the start
        // state (e.g. a "minimized" shortcut) instead of the requested one
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, W, H, SWP_SHOWWINDOW | SWP_NOACTIVATE);
    }
}

/// Updates the phase shown (stored even if the window is not there yet).
pub fn set_phase(phase: &str) {
    PHASE.with(|p| *p.borrow_mut() = phase.to_string());
    SPLASH.with(|s| {
        if let Some(s) = s.borrow_mut().as_mut() {
            s.phase = phase.to_string();
            // SAFETY: window created by `show` on the current thread.
            unsafe {
                InvalidateRect(s.hwnd, null_mut(), 0);
            }
        }
    });
}

/// Closes the window and frees the resources.
pub fn close() {
    // the state is taken out before destroying the window (DestroyWindow sends messages)
    let Some(s) = SPLASH.with(|s| s.borrow_mut().take()) else { return };
    // SAFETY: handles created by `show` and not freed yet.
    unsafe {
        KillTimer(s.hwnd, TIMER);
        DestroyWindow(s.hwnd);
        for f in [s.title_font, s.text_font, s.small_font] {
            DeleteObject(f);
        }
        if !s.icon.is_null() {
            DestroyIcon(s.icon);
        }
    }
}
