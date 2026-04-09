import SwiftUI

struct IMAddFriendScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

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
                Text("添加好友")
                    .font(.system(size: 17, weight: .bold))
                Spacer()
                Circle().fill(.clear).frame(width: 40, height: 40)
            }
            .padding(.horizontal, 16)
            .padding(.top, 56)
            .padding(.bottom, 16)

            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color(.systemGray2))
                TextField("搜索用户名或ID...", text: $searchText)
                    .font(.system(size: 15))
                    .textFieldStyle(.plain)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.white)
                    .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
            )
            .padding(.horizontal, 20)

            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 48))
                    .foregroundStyle(Color(.systemGray3))
                Text("输入用户名或ID来搜索")
                    .font(.system(size: 15))
                    .foregroundStyle(Color(.systemGray2))
            }

            Spacer()
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }
}
