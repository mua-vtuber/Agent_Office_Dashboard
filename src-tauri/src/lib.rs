mod error;

pub use error::{AppError, ConfigError};

pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .run(tauri::generate_context!())
    {
        eprintln!("Fatal: failed to start application: {e}");
        std::process::exit(1);
    }
}
