import SwiftUI

struct ColorTokens {
    let primary = Color("Primary", bundle: .main)
    let primaryVariant = Color("PrimaryVariant", bundle: .main)
    let secondary = Color("Secondary", bundle: .main)
    let secondaryVariant = Color("SecondaryVariant", bundle: .main)

    let background = Color("Background", bundle: .main)
    let surface = Color("Surface", bundle: .main)
    let surfaceVariant = Color("SurfaceVariant", bundle: .main)

    let textPrimary = Color("TextPrimary", bundle: .main)
    let textSecondary = Color("TextSecondary", bundle: .main)
    let textTertiary = Color("TextTertiary", bundle: .main)
    let textDisabled = Color("TextDisabled", bundle: .main)

    let error = Color("Error", bundle: .main)
    let success = Color("Success", bundle: .main)
    let warning = Color("Warning", bundle: .main)
    let info = Color("Info", bundle: .main)

    let border = Color("Border", bundle: .main)
    let divider = Color("Divider", bundle: .main)
    let overlay = Color("Overlay", bundle: .main)

    var fallbackPrimary: Color { Color(red: 0.420, green: 0.275, blue: 0.757) }
    var fallbackBackground: Color { Color(.systemBackground) }
    var fallbackSurface: Color { Color(.secondarySystemBackground) }
    var fallbackTextPrimary: Color { Color(.label) }
    var fallbackTextSecondary: Color { Color(.secondaryLabel) }
    var fallbackError: Color { Color(red: 0.937, green: 0.267, blue: 0.267) }
    var fallbackSuccess: Color { Color(red: 0.133, green: 0.773, blue: 0.369) }
    var fallbackWarning: Color { Color(red: 0.961, green: 0.620, blue: 0.043) }
}
