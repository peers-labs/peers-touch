import SwiftUI

struct IMChatDetailScreen: View {
    let chatId: String
    @Environment(\.dismiss) private var dismiss
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)
    @State private var messageText = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: { dismiss() }) {
                    ZStack {
                        Circle().fill(.white).frame(width: 40, height: 40)
                            .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(Color(.label))
                    }
                }
                Spacer()
                Text("开发团队群")
                    .font(.system(size: 17, weight: .bold))
                Spacer()
                Button(action: {}) {
                    ZStack {
                        Circle().fill(.white).frame(width: 40, height: 40)
                            .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
                        Image(systemName: "ellipsis")
                            .font(.system(size: 18))
                            .foregroundStyle(Color(.label))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 56)
            .padding(.bottom, 16)

            ScrollView {
                VStack(spacing: 20) {
                    Text("昨天 10:42")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color(.systemGray2))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color(.systemGray6)))

                    HStack(alignment: .top, spacing: 12) {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.blue)
                            .frame(width: 40, height: 40)
                            .overlay {
                                Text("张")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        Text("API接口已经更新，请查收。文档地址：http://api.docs...")
                            .font(.system(size: 15))
                            .foregroundStyle(Color(.label))
                            .padding(16)
                            .background(
                                RoundedRectangle(cornerRadius: 24)
                                    .fill(.white)
                                    .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                            )
                        Spacer(minLength: 60)
                    }

                    HStack {
                        Spacer(minLength: 60)
                        Text("收到，我马上测试一下。")
                            .font(.system(size: 15))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 24)
                                    .fill(brandPurple)
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }

            HStack(spacing: 12) {
                Button(action: {}) {
                    ZStack {
                        Circle().fill(Color(.systemGray6)).frame(width: 44, height: 44)
                        Image(systemName: "plus")
                            .font(.system(size: 22))
                            .foregroundStyle(Color(.systemGray))
                    }
                }

                HStack {
                    TextField("输入消息...", text: $messageText)
                        .font(.system(size: 15))
                        .textFieldStyle(.plain)
                        .padding(.leading, 12)
                    Button(action: {}) {
                        Image(systemName: "face.smiling")
                            .font(.system(size: 22))
                            .foregroundStyle(Color(.systemGray2))
                    }
                    .padding(.trailing, 8)
                }
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(Color(.systemGray6))
                        .overlay(Capsule().stroke(Color(.systemGray5), lineWidth: 0.5))
                )

                Button(action: {}) {
                    ZStack {
                        Circle().fill(brandPurple).frame(width: 44, height: 44)
                            .shadow(color: brandPurple.opacity(0.3), radius: 4, y: 2)
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.white)
                            .offset(x: 1)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.white)
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }
}
