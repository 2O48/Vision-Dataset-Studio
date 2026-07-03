#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{image::Image, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
mod parent_console {
    use std::{
        ffi::c_void,
        ptr,
        sync::Once,
    };

    type Handle = *mut c_void;

    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;

    extern "system" {
        fn AttachConsole(dwProcessId: u32) -> i32;
        fn GetStdHandle(nStdHandle: u32) -> Handle;
        fn WriteConsoleW(
            hConsoleOutput: Handle,
            lpBuffer: *const u16,
            nNumberOfCharsToWrite: u32,
            lpNumberOfCharsWritten: *mut u32,
            lpReserved: *mut c_void,
        ) -> i32;
    }

    static ATTACH_PARENT: Once = Once::new();

    pub fn write_line(line: &str) {
        ATTACH_PARENT.call_once(|| unsafe {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        });

        let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        if handle.is_null() || handle as isize == -1 {
            return;
        }

        let text: Vec<u16> = format!("{}\r\n", line).encode_utf16().collect();
        let mut written = 0;
        unsafe {
            let _ = WriteConsoleW(
                handle,
                text.as_ptr(),
                text.len() as u32,
                &mut written,
                ptr::null_mut(),
            );
        }
    }
}

#[cfg(not(windows))]
mod parent_console {
    pub fn write_line(line: &str) {
        println!("{}", line);
    }
}

#[cfg(windows)]
mod log_encoding {
    use std::ptr;

    extern "system" {
        fn GetACP() -> u32;
        fn MultiByteToWideChar(
            CodePage: u32,
            dwFlags: u32,
            lpMultiByteStr: *const u8,
            cbMultiByte: i32,
            lpWideCharStr: *mut u16,
            cchWideChar: i32,
        ) -> i32;
    }

    pub fn decode(bytes: &[u8]) -> String {
        if let Ok(value) = std::str::from_utf8(bytes) {
            return value.to_string();
        }
        decode_code_page(unsafe { GetACP() }, bytes)
            .unwrap_or_else(|| String::from_utf8_lossy(bytes).to_string())
    }

    fn decode_code_page(code_page: u32, bytes: &[u8]) -> Option<String> {
        if bytes.is_empty() {
            return Some(String::new());
        }
        let len = unsafe {
            MultiByteToWideChar(
                code_page,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                ptr::null_mut(),
                0,
            )
        };
        if len <= 0 {
            return None;
        }
        let mut wide = vec![0u16; len as usize];
        let written = unsafe {
            MultiByteToWideChar(
                code_page,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                wide.as_mut_ptr(),
                wide.len() as i32,
            )
        };
        if written <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&wide[..written as usize]))
    }
}

#[cfg(not(windows))]
mod log_encoding {
    pub fn decode(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }
}

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8100;
const PORT_SCAN_LIMIT: u16 = 20;
const ROOT_REQUIRED_PREFIX: &str = "PROJECT_ROOT_REQUIRED:";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_TERMINAL_THEME: &str = r#":root {
  color-scheme: light;
  --terminal-bg: #eeeeee;
  --terminal-text: #424956;
  --terminal-muted: #6b7280;
  --terminal-line: rgba(55, 56, 60, 0.12);
}"#;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct LauncherState {
    backend: Mutex<Option<Child>>,
    logs: Mutex<Vec<String>>,
    terminal_theme: Mutex<String>,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launcher_minimize,
            launcher_maximize,
            launcher_close,
            launcher_drag,
            launcher_open_terminal,
            launcher_terminal_logs,
            launcher_log_status,
            launcher_project_root,
            launcher_set_project_root,
            launcher_pick_project_root,
            launcher_start_backend,
            launcher_set_terminal_theme,
            launcher_terminal_theme,
        ])
        .manage(Arc::new(LauncherState {
            backend: Mutex::new(None),
            logs: Mutex::new(vec!["[launcher] terminal ready".to_string()]),
            terminal_theme: Mutex::new(DEFAULT_TERMINAL_THEME.to_string()),
        }))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/icon-512.png")) {
                    let _ = window.set_icon(icon);
                }
                apply_platform_window_style(&window);
            }

            start_backend_for_app(app.handle().clone(), app.state::<Arc<LauncherState>>().inner().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "terminal" {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }

                if window.label() == "main" {
                    let state = window.state::<Arc<LauncherState>>().inner().clone();
                    exit_launcher(window.app_handle(), &state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run launcher");
}

#[tauri::command]
fn launcher_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn launcher_maximize(window: tauri::Window) {
    match window.is_maximized() {
        Ok(true) => {
            let _ = window.unmaximize();
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn launcher_close(
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, Arc<LauncherState>>,
) {
    if window.label() == "main" {
        exit_launcher(&app, state.inner());
        return;
    }
    let _ = window.close();
}

#[tauri::command]
fn launcher_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn launcher_terminal_logs(state: tauri::State<'_, Arc<LauncherState>>) -> String {
    match state.logs.lock() {
        Ok(logs) => logs.join("\n"),
        Err(_) => "[launcher] failed to read terminal logs".to_string(),
    }
}

#[tauri::command]
fn launcher_log_status(state: tauri::State<'_, Arc<LauncherState>>, message: String) {
    let message = message.trim();
    if message.is_empty() {
        return;
    }
    push_log(&state, format!("[status] {}", message));
}

#[tauri::command]
fn launcher_project_root() -> String {
    configured_project_root()
        .or_else(|| infer_project_root().ok())
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn launcher_set_project_root(path: String) -> Result<String, String> {
    let root = validate_project_root(&path)?;
    save_configured_project_root(&root)?;
    Ok(root.display().to_string())
}

#[tauri::command]
fn launcher_pick_project_root() -> Result<String, String> {
    pick_project_root_dir().and_then(|path| {
        validate_project_root(&path.display().to_string()).map(|root| root.display().to_string())
    })
}

#[tauri::command]
fn launcher_start_backend(app: AppHandle, state: tauri::State<'_, Arc<LauncherState>>) {
    start_backend_for_app(app, state.inner().clone());
}

#[tauri::command]
fn launcher_set_terminal_theme(
    state: tauri::State<'_, Arc<LauncherState>>,
    css: String,
) -> Result<(), String> {
    if css.len() > 4096 {
        return Err("terminal theme css is too large".to_string());
    }

    let mut theme = state
        .terminal_theme
        .lock()
        .map_err(|_| "failed to lock terminal theme".to_string())?;
    *theme = css;
    Ok(())
}

#[tauri::command]
fn launcher_terminal_theme(state: tauri::State<'_, Arc<LauncherState>>) -> String {
    state
        .terminal_theme
        .lock()
        .map(|theme| theme.clone())
        .unwrap_or_else(|_| DEFAULT_TERMINAL_THEME.to_string())
}

#[tauri::command]
fn launcher_open_terminal(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("terminal") {
        apply_platform_window_style(&window);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let icon = Image::from_bytes(include_bytes!("../icons/icon-512.png")).ok();
    let mut builder = WebviewWindowBuilder::new(
        &app,
        "terminal",
        WebviewUrl::App("/terminal.html".into()),
    )
    .title("Vision Dataset Studio Terminal")
    .inner_size(920.0, 560.0)
    .min_inner_size(680.0, 420.0)
    .center()
    .resizable(true)
    .decorations(false);
    if let Some(icon) = icon {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    apply_platform_window_style(&window);
    let _ = window.set_focus();
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_platform_window_style(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
fn apply_platform_window_style(window: &tauri::WebviewWindow) {
    use objc2::rc::Retained;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_app_kit::{NSColor, NSWindow};
    use objc2_foundation::{NSPoint, NSRect};

    const CORNER_RADIUS: f64 = 16.0;
    const NS_WINDOW_STYLE_MASK_TITLED: usize = 1 << 0;
    const NS_WINDOW_STYLE_MASK_CLOSABLE: usize = 1 << 1;
    const NS_WINDOW_STYLE_MASK_MINIATURIZABLE: usize = 1 << 2;
    const NS_WINDOW_STYLE_MASK_RESIZABLE: usize = 1 << 3;
    const NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW: usize = 1 << 15;
    const NS_WINDOW_TITLE_HIDDEN: isize = 1;

    unsafe fn round_view(view: *mut AnyObject, radius: f64) {
        if view.is_null() {
            return;
        }

        let _: () = unsafe { msg_send![view, setWantsLayer: true] };
        let layer: *mut AnyObject = unsafe { msg_send![view, layer] };
        if !layer.is_null() {
            let _: () = unsafe { msg_send![layer, setCornerRadius: radius] };
            let _: () = unsafe { msg_send![layer, setMasksToBounds: true] };
        }
    }

    unsafe fn place_standard_button(ns_window: &NSWindow, button_kind: usize, x: f64) {
        let button: *mut AnyObject = unsafe { msg_send![ns_window, standardWindowButton: button_kind] };
        if button.is_null() {
            return;
        }

        let superview: *mut AnyObject = unsafe { msg_send![button, superview] };
        let y = if superview.is_null() {
            0.0
        } else {
            let bounds: NSRect = unsafe { msg_send![superview, bounds] };
            (bounds.size.height - 27.0).max(5.0)
        };
        let _: () = unsafe { msg_send![button, setHidden: false] };
        let _: () = unsafe { msg_send![button, setFrameOrigin: NSPoint::new(x, y)] };
    }

    unsafe fn enable_native_traffic_lights(ns_window: &NSWindow) {
        let style_mask: usize = unsafe { msg_send![ns_window, styleMask] };
        let style_mask = style_mask
            | NS_WINDOW_STYLE_MASK_TITLED
            | NS_WINDOW_STYLE_MASK_CLOSABLE
            | NS_WINDOW_STYLE_MASK_MINIATURIZABLE
            | NS_WINDOW_STYLE_MASK_RESIZABLE
            | NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW;
        let _: () = unsafe { msg_send![ns_window, setStyleMask: style_mask] };
        let _: () = unsafe { msg_send![ns_window, setTitleVisibility: NS_WINDOW_TITLE_HIDDEN] };
        let _: () = unsafe { msg_send![ns_window, setTitlebarAppearsTransparent: true] };

        place_standard_button(ns_window, 0, 18.0);
        place_standard_button(ns_window, 1, 38.0);
        place_standard_button(ns_window, 2, 58.0);
    }

    unsafe {
        if let Ok(ns_window_ptr) = window.ns_window() {
            if !ns_window_ptr.is_null() {
                let ns_window: &NSWindow = &*ns_window_ptr.cast();
                enable_native_traffic_lights(ns_window);
                ns_window.setOpaque(false);
                ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
                ns_window.setHasShadow(true);

                if let Some(content_view) = ns_window.contentView() {
                    round_view(Retained::as_ptr(&content_view).cast_mut().cast(), CORNER_RADIUS);
                }
            }
        }

        if let Ok(ns_view_ptr) = window.ns_view() {
            if !ns_view_ptr.is_null() {
                round_view(ns_view_ptr.cast(), CORNER_RADIUS);
            }
        }
    }
}

fn start_backend_for_app(app_handle: AppHandle, state: Arc<LauncherState>) {
    thread::spawn(move || {
        let result = launch_backend(state);
        let window = app_handle.get_webview_window("main");

        match (result, window) {
            (Ok(url), Some(window)) => {
                let launcher_url = format!("{}/?vds_launcher=1", url);
                let script = format!("window.location.replace({:?});", launcher_url);
                let _ = window.eval(&script);
            }
            (Err(message), Some(window)) if message.starts_with(ROOT_REQUIRED_PREFIX) => {
                let clean_message = message.trim_start_matches(ROOT_REQUIRED_PREFIX).trim();
                let script = format!(
                    "window.__vdsShowProjectRootSetup && window.__vdsShowProjectRootSetup({:?});",
                    clean_message
                );
                let _ = window.eval(&script);
            }
            (Err(message), Some(window)) => {
                let script = startup_error_page(&message);
                let _ = window.eval(&script);
            }
            _ => {}
        }
    });
}

fn launch_backend(state: Arc<LauncherState>) -> Result<String, String> {
    let root = find_repo_root()?;
    let host = env::var("VDS_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
    let start_port = env::var("VDS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);

    let mut last_error = String::new();
    for offset in 0..=PORT_SCAN_LIMIT {
        let Some(port) = start_port.checked_add(offset) else {
            break;
        };
        let url = format!("http://{}:{}", host, port);

        if wait_for_port(&host, port, Duration::from_millis(200)) {
            if backend_ready(&host, port) {
                push_log(&state, format!("[launcher] using existing backend at {}", url));
                update_repo_in_background(root);
                return Ok(url);
            }
            push_log(
                &state,
                format!(
                    "[launcher] backend at {} is outdated or incompatible; trying next port",
                    url
                ),
            );
            last_error = format!("Port {} is already used by an outdated backend.", port);
            continue;
        }

        let child = start_existing_script(&root, &host, port, state.clone())?;
        {
            let mut backend = state
                .backend
                .lock()
                .map_err(|_| "Failed to lock backend process state.".to_string())?;
            *backend = Some(child);
        }

        if wait_for_port(&host, port, STARTUP_TIMEOUT) && backend_ready(&host, port) {
            update_repo_in_background(root);
            return Ok(url);
        }

        stop_backend(&state);
        last_error = format!("Timed out waiting for compatible backend at {}.", url);
    }

    Err(format!(
        "Could not start a compatible backend from port {} to {}. {}\n\nClose old server processes or set VDS_PORT to a free port, then start the launcher again.",
        start_port,
        start_port.saturating_add(PORT_SCAN_LIMIT),
        last_error
    ))
}

fn update_repo_in_background(root: PathBuf) {
    if env::var("VDS_SKIP_UPDATE").ok().as_deref() == Some("1") {
        return;
    }
    thread::spawn(move || {
        maybe_update_repo(&root);
    });
}

fn with_hidden_window(command: &mut Command) {
    #[cfg(not(windows))]
    let _ = command;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn push_log(state: &Arc<LauncherState>, line: impl Into<String>) {
    let line = line.into();
    parent_console::write_line(&line);
    if let Ok(mut logs) = state.logs.lock() {
        logs.push(line);
        let overflow = logs.len().saturating_sub(3000);
        if overflow > 0 {
            logs.drain(0..overflow);
        }
    }
}

fn pipe_log_reader<R>(state: Arc<LauncherState>, label: &'static str, reader: R)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    while matches!(buffer.last(), Some(b'\n' | b'\r')) {
                        buffer.pop();
                    }
                    let line = log_encoding::decode(&buffer);
                    push_log(&state, format!("[{}] {}", label, line));
                }
                Err(error) => {
                    push_log(&state, format!("[launcher] {} log read error: {}", label, error));
                    break;
                }
            }
        }
    });
}

fn project_venv_python(root: &Path) -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![
            root.join(".venv").join("Scripts").join("python.exe"),
            root.join(".venv").join("Scripts").join("pythonw.exe"),
        ]
    } else {
        vec![
            root.join(".venv").join("bin").join("python3"),
            root.join(".venv").join("bin").join("python"),
        ]
    };
    candidates.into_iter().find(|path| path.is_file())
}

fn start_backend_direct(
    root: &Path,
    host: &str,
    port: u16,
    state: Arc<LauncherState>,
) -> Option<Result<Child, String>> {
    let python = project_venv_python(root)?;
    push_log(&state, format!("[launcher] starting backend directly: {}", python.display()));
    let mut command = Command::new(python);
    command
        .arg("-u")
        .arg(root.join("web_server.py"))
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(root)
        .env("HOST", host)
        .env("PORT", port.to_string())
        .env("KILL_EXISTING", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    with_hidden_window(&mut command);

    Some(match command.spawn() {
        Ok(mut child) => {
            if let Some(stdout) = child.stdout.take() {
                pipe_log_reader(state.clone(), "stdout", stdout);
            }
            if let Some(stderr) = child.stderr.take() {
                pipe_log_reader(state, "stderr", stderr);
            }
            Ok(child)
        }
        Err(err) => Err(format!("Failed to start backend directly: {}", err)),
    })
}

fn start_existing_script(
    root: &Path,
    host: &str,
    port: u16,
    state: Arc<LauncherState>,
) -> Result<Child, String> {
    if let Some(result) = start_backend_direct(root, host, port, state.clone()) {
        return result;
    }

    push_log(&state, "[launcher] starting backend through existing script");
    let mut command = if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "scripts\\run.bat"]);
        cmd
    } else {
        let script = root.join("scripts").join("start.sh");
        let mut cmd = Command::new("bash");
        cmd.arg(script);
        cmd
    };

    command
        .current_dir(root)
        .env("HOST", host)
        .env("PORT", port.to_string())
        .env("KILL_EXISTING", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    with_hidden_window(&mut command);

    match command.spawn() {
        Ok(mut child) => {
            if let Some(stdout) = child.stdout.take() {
                pipe_log_reader(state.clone(), "stdout", stdout);
            }
            if let Some(stderr) = child.stderr.take() {
                pipe_log_reader(state, "stderr", stderr);
            }
            Ok(child)
        }
        Err(err) => Err(format!("Failed to start backend script: {}", err)),
    }
}

fn startup_error_page(message: &str) -> String {
    let retry_url = message
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| part.trim_end_matches(['.', ',', ';']).to_string());
    let retry_script = retry_url.map_or_else(String::new, |url| {
        format!(
            "const retryUrl = {url:?}; const retry = async () => {{ try {{ const response = await fetch(`${{retryUrl}}/launcher/titlebar.js`, {{ cache: 'no-store' }}); if (response.ok) window.location.replace(`${{retryUrl}}/?vds_launcher=1`); }} catch (_) {{}} }}; setInterval(retry, 500); retry();"
        )
    });
    let _ = message;
    retry_script
}

fn find_repo_root() -> Result<PathBuf, String> {
    if let Ok(root) = env::var("VDS_REPO_ROOT") {
        let path = PathBuf::from(root);
        if is_project_root(&path) {
            return Ok(path);
        }
    }

    if let Some(path) = configured_project_root() {
        if is_project_root(&path) {
            return Ok(path);
        }
    }

    Err(format!(
        "{} Could not find the Vision Dataset Studio project root. Select the folder that contains web_server.py, frontend, and scripts.",
        ROOT_REQUIRED_PREFIX
    ))
}

fn infer_project_root() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(current) = env::current_dir() {
        candidates.push(current);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for start in candidates {
        for ancestor in start.ancestors() {
            if is_project_root(ancestor) {
                return Ok(ancestor.to_path_buf());
            }
            if let Some(parent) = ancestor.parent() {
                if is_project_root(parent) {
                    return Ok(parent.to_path_buf());
                }
            }
        }
    }

    Err("Could not infer project root.".to_string())
}

fn launcher_config_file() -> PathBuf {
    if let Ok(home) = env::var("HOME") {
        return PathBuf::from(home)
            .join(".vision_dataset_studio")
            .join("launcher-root.txt");
    }
    if let Ok(userprofile) = env::var("USERPROFILE") {
        return PathBuf::from(userprofile)
            .join(".vision_dataset_studio")
            .join("launcher-root.txt");
    }
    env::temp_dir()
        .join(".vision_dataset_studio")
        .join("launcher-root.txt")
}

fn configured_project_root() -> Option<PathBuf> {
    let raw = fs::read_to_string(launcher_config_file()).ok()?;
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn save_configured_project_root(root: &Path) -> Result<(), String> {
    let file = launcher_config_file();
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(file, root.display().to_string()).map_err(|error| error.to_string())
}

fn validate_project_root(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim().trim_matches('"'));
    if is_project_root(&path) {
        Ok(path)
    } else {
        Err("请选择 Vision Dataset Studio 项目根目录：该目录需要包含 web_server.py、frontend 和 scripts。".to_string())
    }
}

fn pick_project_root_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 Vision Dataset Studio 项目根目录'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Err("未选择目录。".to_string());
        }
        return Ok(PathBuf::from(selected));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args(["-e", "POSIX path of (choose folder with prompt \"选择 Vision Dataset Studio 项目根目录\")"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Err("未选择目录。".to_string());
        }
        return Ok(PathBuf::from(selected));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let output = Command::new("zenity")
            .args(["--file-selection", "--directory", "--title=选择 Vision Dataset Studio 项目根目录"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Err("未选择目录。".to_string());
        }
        return Ok(PathBuf::from(selected));
    }
}

fn is_project_root(path: &Path) -> bool {
    path.join("web_server.py").is_file()
        && path.join("frontend").is_dir()
        && path.join("scripts").is_dir()
}

fn maybe_update_repo(root: &Path) {
    if env::var("VDS_SKIP_UPDATE").ok().as_deref() == Some("1") {
        return;
    }
    if !root.join(".git").exists() {
        return;
    }
    if run_git(root, &["--version"]).is_err() {
        return;
    }

    let remote = env::var("VDS_UPDATE_REMOTE").unwrap_or_else(|_| "origin".to_string());
    let branch = env::var("VDS_UPDATE_BRANCH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| run_git(root, &["branch", "--show-current"]).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "main".to_string());

    let _ = run_git(root, &["fetch", "--quiet", &remote, &branch]);

    let status = run_git(root, &["status", "--porcelain"]).unwrap_or_default();
    if !status.trim().is_empty() {
        return;
    }

    let local = run_git(root, &["rev-parse", "HEAD"]).unwrap_or_default();
    let upstream_ref = format!("{}/{}", remote, branch);
    let upstream = run_git(root, &["rev-parse", &upstream_ref]).unwrap_or_default();

    if !local.trim().is_empty() && !upstream.trim().is_empty() && local.trim() != upstream.trim() {
        let _ = run_git(root, &["pull", "--ff-only", &remote, &branch]);
    }
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    with_hidden_window(&mut command);

    let output = command
        .output()
        .map_err(|err| err.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn wait_for_port(host: &str, port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() <= deadline {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn backend_ready(host: &str, port: u16) -> bool {
    launcher_asset_ready(host, port, "/launcher/titlebar.js")
        && route_exists(host, port, "/api/item/swap-images")
        && route_exists(host, port, "/api/status/log")
}

fn launcher_asset_ready(host: &str, port: u16, path: &str) -> bool {
    let mut stream = match TcpStream::connect((host, port)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        path, host, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200")
}

fn route_exists(host: &str, port: u16, path: &str) -> bool {
    let mut stream = match TcpStream::connect((host, port)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let body = "{}";
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        host,
        port,
        body.len(),
        body
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    !response.contains(&format!("Unknown route: {}", path))
}

fn exit_launcher(app: &AppHandle, state: &Arc<LauncherState>) {
    stop_backend(state);
    app.exit(0);
}

fn stop_backend(state: &Arc<LauncherState>) {
    let child = {
        let mut backend = match state.backend.lock() {
            Ok(backend) => backend,
            Err(_) => return,
        };
        backend.take()
    };

    if let Some(mut child) = child {
        #[cfg(windows)]
        {
            let pid = child.id().to_string();
            let mut command = Command::new("taskkill");
            command
                .args(["/PID", &pid, "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            with_hidden_window(&mut command);
            let _ = command
                .status();
        }

        #[cfg(not(windows))]
        {
            let _ = child.kill();
        }

        let _ = child.wait();
    }
}
