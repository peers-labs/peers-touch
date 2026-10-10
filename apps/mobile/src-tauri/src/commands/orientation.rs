#![cfg(any(test, feature = "acceptance-harness"))]

use serde::Serialize;

use crate::error::{MobileError, MobileResult};

const PORTRAIT: u32 = 1;
const LANDSCAPE: u32 = 2;

#[cfg(target_os = "ios")]
extern "C" {
    fn peers_acceptance_request_interface_orientation(orientation: u32) -> bool;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceOrientationResult {
    requested: &'static str,
}

#[tauri::command]
pub fn mobile_acceptance_set_orientation(
    orientation: String,
) -> MobileResult<AcceptanceOrientationResult> {
    let (requested, code) = orientation_request(&orientation)?;

    #[cfg(target_os = "ios")]
    {
        let accepted = unsafe { peers_acceptance_request_interface_orientation(code) };
        if !accepted {
            return Err(MobileError::invalid_input(
                "acceptance.mobile.orientationRejected",
            ));
        }
        return Ok(AcceptanceOrientationResult { requested });
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (requested, code);
        Err(MobileError::invalid_input(
            "acceptance.mobile.orientationUnsupported",
        ))
    }
}

fn orientation_request(orientation: &str) -> MobileResult<(&'static str, u32)> {
    match orientation {
        "portrait" => Ok(("portrait", PORTRAIT)),
        "landscape" => Ok(("landscape", LANDSCAPE)),
        _ => Err(MobileError::invalid_input(
            "acceptance.mobile.orientationInvalid",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{orientation_request, LANDSCAPE, PORTRAIT};

    #[test]
    fn accepts_only_the_surface_matrix_orientations() {
        assert_eq!(
            orientation_request("portrait").unwrap(),
            ("portrait", PORTRAIT)
        );
        assert_eq!(
            orientation_request("landscape").unwrap(),
            ("landscape", LANDSCAPE)
        );
        assert!(orientation_request("unknown").is_err());
    }
}
