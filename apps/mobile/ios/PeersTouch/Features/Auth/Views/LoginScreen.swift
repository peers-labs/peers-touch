import SwiftUI

struct LoginScreen: View {
    @Environment(\.dismiss) private var dismiss
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)
    @State private var scanSuccess = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: { dismiss() }) {
                    ZStack {
                        Circle().fill(.white).frame(width: 44, height: 44)
                            .shadow(color: .black.opacity(0.08), radius: 6, y: 3)
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(Color(.label))
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 56)

            Spacer()

            VStack(spacing: 32) {
                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(brandPurple)
                        .frame(width: 80, height: 80)
                        .shadow(color: brandPurple.opacity(0.35), radius: 16, y: 8)
                    Image(systemName: "laptopcomputer.and.iphone")
                        .font(.system(size: 36))
                        .foregroundStyle(.white)
                }

                VStack(spacing: 12) {
                    Text("扫码登录")
                        .font(.system(size: 30, weight: .bold))
                    Text("请使用桌面端 Agent Box 扫描下方二维码\n以同步您的账号和配置信息")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(.systemGray))
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                }

                ZStack {
                    RoundedRectangle(cornerRadius: 32)
                        .fill(.white)
                        .frame(width: 288, height: 288)
                        .shadow(color: .black.opacity(0.06), radius: 16, y: 8)

                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(.systemGray6))
                        .frame(width: 248, height: 248)
                        .overlay {
                            Image(systemName: "qrcode")
                                .font(.system(size: 160))
                                .foregroundStyle(Color(.label))
                        }

                    if scanSuccess {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.white.opacity(0.9))
                            .frame(width: 248, height: 248)
                            .overlay {
                                ZStack {
                                    Circle()
                                        .fill(.green)
                                        .frame(width: 64, height: 64)
                                        .shadow(color: .green.opacity(0.3), radius: 8, y: 4)
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 28, weight: .bold))
                                        .foregroundStyle(.white)
                                }
                            }
                    }

                    cornerMarkers
                }

                if scanSuccess {
                    Text("扫描成功，正在登录...")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.green)
                } else {
                    Button(action: { withAnimation { scanSuccess = true } }) {
                        Text("模拟扫描成功")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(brandPurple)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(
                                Capsule()
                                    .fill(brandPurple.opacity(0.1))
                            )
                    }
                }
            }

            Spacer()
            Spacer()
        }
        .background(Color.white)
        .navigationBarHidden(true)
    }

    private var cornerMarkers: some View {
        ZStack {
            cornerMark(corner: .topLeading)
            cornerMark(corner: .topTrailing)
            cornerMark(corner: .bottomLeading)
            cornerMark(corner: .bottomTrailing)
        }
        .frame(width: 288, height: 288)
    }

    private func cornerMark(corner: Alignment) -> some View {
        let size: CGFloat = 40
        let lineWidth: CGFloat = 4
        return ZStack {
            if corner == .topLeading {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: size))
                    p.addLine(to: CGPoint(x: 0, y: lineWidth * 2))
                    p.addQuadCurve(to: CGPoint(x: lineWidth * 2, y: 0), control: CGPoint(x: 0, y: 0))
                    p.addLine(to: CGPoint(x: size, y: 0))
                }
                .stroke(brandPurple, lineWidth: lineWidth)
            } else if corner == .topTrailing {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: 0))
                    p.addLine(to: CGPoint(x: size - lineWidth * 2, y: 0))
                    p.addQuadCurve(to: CGPoint(x: size, y: lineWidth * 2), control: CGPoint(x: size, y: 0))
                    p.addLine(to: CGPoint(x: size, y: size))
                }
                .stroke(brandPurple, lineWidth: lineWidth)
            } else if corner == .bottomLeading {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: 0))
                    p.addLine(to: CGPoint(x: 0, y: size - lineWidth * 2))
                    p.addQuadCurve(to: CGPoint(x: lineWidth * 2, y: size), control: CGPoint(x: 0, y: size))
                    p.addLine(to: CGPoint(x: size, y: size))
                }
                .stroke(brandPurple, lineWidth: lineWidth)
            } else {
                Path { p in
                    p.move(to: CGPoint(x: size, y: 0))
                    p.addLine(to: CGPoint(x: size, y: size - lineWidth * 2))
                    p.addQuadCurve(to: CGPoint(x: size - lineWidth * 2, y: size), control: CGPoint(x: size, y: size))
                    p.addLine(to: CGPoint(x: 0, y: size))
                }
                .stroke(brandPurple, lineWidth: lineWidth)
            }
        }
        .frame(width: size, height: size)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner)
        .padding(20)
    }
}
