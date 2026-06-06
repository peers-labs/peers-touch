#![allow(dead_code)]

use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) const DEFAULT_CLI_TIMEOUT_MS: u64 = 60_000;
const CLI_WAIT_POLL_MS: u64 = 20;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CliExecutionControl {
    pub(crate) timeout_ms: Option<u64>,
    pub(crate) cwd: Option<String>,
    pub(crate) env: Vec<(String, String)>,
}

#[derive(Debug)]
pub(crate) struct CliCompletionResult {
    pub(crate) text: String,
    pub(crate) model: String,
}

fn split_command_spec(command_spec: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command_spec.chars().peekable();
    let mut quote: Option<char> = None;
    let mut escaping = false;

    while let Some(ch) = chars.next() {
        if escaping {
            current.push(ch);
            escaping = false;
            continue;
        }
        if ch == '\\' {
            escaping = true;
            continue;
        }
        if let Some(quote_char) = quote {
            if ch == quote_char {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(current);
                current = String::new();
            }
            while chars.peek().is_some_and(|next| next.is_whitespace()) {
                chars.next();
            }
            continue;
        }
        current.push(ch);
    }

    if escaping {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("CLI provider command contains an unterminated quote".to_string());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err("CLI provider command is required".to_string());
    }
    Ok(parts)
}

pub(crate) fn validate_command_spec(command_spec: &str) -> Result<(), String> {
    split_command_spec(command_spec).map(|_| ())
}

fn wait_with_optional_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|err| format!("wait for CLI provider failed: {}", err));
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait_with_output();
                    return Err(format!(
                        "CLI provider timed out after {} ms",
                        timeout.as_millis()
                    ));
                }
                thread::sleep(Duration::from_millis(CLI_WAIT_POLL_MS));
            }
            Err(err) => return Err(format!("poll CLI provider failed: {}", err)),
        }
    }
}

pub(crate) fn complete(
    command_spec: &str,
    model: &str,
    prompt: &str,
    control: &CliExecutionControl,
) -> Result<CliCompletionResult, String> {
    let mut parts = split_command_spec(command_spec)?;
    let command = parts.remove(0);
    let timeout = Duration::from_millis(control.timeout_ms.unwrap_or(DEFAULT_CLI_TIMEOUT_MS));
    tracing::info!(
        command = %command,
        model = %model,
        timeout_ms = timeout.as_millis(),
        cwd = ?control.cwd,
        "Starting CLI-wrapped provider completion"
    );

    let mut command_builder = Command::new(command);
    command_builder
        .args(parts)
        .arg("--model")
        .arg(model)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = control.cwd.as_deref() {
        command_builder.current_dir(cwd);
    }
    for (key, value) in &control.env {
        command_builder.env(key, value);
    }

    let mut child = command_builder
        .spawn()
        .map_err(|err| format!("spawn CLI provider failed: {}", err))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|err| format!("write prompt to CLI provider failed: {}", err))?;
    }
    let output = wait_with_optional_timeout(child, timeout)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("CLI provider exited with {}", output.status)
        } else {
            stderr
        });
    }

    Ok(CliCompletionResult {
        text: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        model: model.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_spec_should_keep_quoted_arguments() {
        assert_eq!(
            split_command_spec(r#"codex exec --flag "two words" 'three words'"#)
                .expect("command should parse"),
            vec!["codex", "exec", "--flag", "two words", "three words"]
        );
    }

    #[test]
    fn split_command_spec_should_reject_unterminated_quote() {
        assert_eq!(
            split_command_spec(r#"codex "unterminated"#).expect_err("command should fail"),
            "CLI provider command contains an unterminated quote"
        );
    }

    #[cfg(unix)]
    #[test]
    fn complete_should_pass_prompt_model_cwd_and_env() {
        let cwd = std::fs::canonicalize("/tmp")
            .expect("tmp directory should exist")
            .to_string_lossy()
            .to_string();
        let result = complete(
            r#"/bin/sh -c "printf '%s|%s|%s|%s' \"$(cat)\" \"$1\" \"$PEERS_AGENT_TEST_ENV\" \"$(pwd)\"""#,
            "test-model",
            "hello",
            &CliExecutionControl {
                timeout_ms: Some(1_000),
                cwd: Some(cwd.clone()),
                env: vec![("PEERS_AGENT_TEST_ENV".to_string(), "enabled".to_string())],
            },
        )
        .expect("cli should complete");

        assert_eq!(result.text, format!("hello|test-model|enabled|{cwd}"));
        assert_eq!(result.model, "test-model");
    }

    #[cfg(unix)]
    #[test]
    fn complete_should_timeout() {
        let error = complete(
            r#"/bin/sh -c "sleep 1""#,
            "test-model",
            "hello",
            &CliExecutionControl {
                timeout_ms: Some(10),
                cwd: None,
                env: vec![],
            },
        )
        .expect_err("cli should timeout");

        assert_eq!(error, "CLI provider timed out after 10 ms");
    }
}
