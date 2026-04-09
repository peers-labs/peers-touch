import SwiftUI

struct Typography {
    let largeTitle = Font.system(size: 34, weight: .bold, design: .default)
    let title1 = Font.system(size: 28, weight: .bold, design: .default)
    let title2 = Font.system(size: 22, weight: .bold, design: .default)
    let title3 = Font.system(size: 20, weight: .semibold, design: .default)
    let headline = Font.system(size: 17, weight: .semibold, design: .default)
    let body = Font.system(size: 17, weight: .regular, design: .default)
    let callout = Font.system(size: 16, weight: .regular, design: .default)
    let subheadline = Font.system(size: 15, weight: .regular, design: .default)
    let footnote = Font.system(size: 13, weight: .regular, design: .default)
    let caption1 = Font.system(size: 12, weight: .regular, design: .default)
    let caption2 = Font.system(size: 11, weight: .regular, design: .default)

    let monoBody = Font.system(size: 17, weight: .regular, design: .monospaced)
    let monoCaption = Font.system(size: 12, weight: .regular, design: .monospaced)
}
