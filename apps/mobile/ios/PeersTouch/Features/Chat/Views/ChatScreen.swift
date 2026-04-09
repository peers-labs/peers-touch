import SwiftUI

struct IMChatScreen: View {
    @State private var selectedTab = 0

    struct ChatItem: Identifiable {
        let id: Int
        let name: String
        let message: String
        let time: String
        let unread: Int
        let type: String
    }

    struct ContactItem: Identifiable {
        let id: Int
        let name: String
        let status: String
        let color: Color
    }

    private let chats: [ChatItem] = [
        ChatItem(id: 1, name: "开发团队群", message: "API接口已经更新，请查收", time: "10:42", unread: 3, type: "group"),
        ChatItem(id: 2, name: "张三", message: "好的，我马上处理", time: "昨天", unread: 0, type: "single"),
        ChatItem(id: 3, name: "系统通知", message: "您的定时任务已执行完毕", time: "星期二", unread: 1, type: "system"),
    ]

    private let contacts: [ContactItem] = [
        ContactItem(id: 2, name: "张三", status: "在线", color: .green),
        ContactItem(id: 4, name: "李四", status: "离线", color: .gray),
        ContactItem(id: 5, name: "王五", status: "忙碌", color: .red),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("", selection: $selectedTab) {
                    Image(systemName: "message.fill").tag(0)
                    Image(systemName: "person.2.fill").tag(1)
                }
                .pickerStyle(.segmented)
                .frame(width: 120)

                Spacer()

                NavigationLink(value: Route.imAddFriend) {
                    ZStack {
                        Circle()
                            .fill(.white)
                            .frame(width: 40, height: 40)
                            .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
                        Image(systemName: "person.badge.plus")
                            .font(.system(size: 18))
                            .foregroundStyle(Color(.label))
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 56)
            .padding(.bottom, 16)

            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18))
                    .foregroundStyle(Color(.systemGray2))
                Text(selectedTab == 0 ? "搜索消息..." : "搜索联系人...")
                    .font(.system(size: 15))
                    .foregroundStyle(Color(.systemGray2))
                Spacer()
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.white)
                    .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(.systemGray5), lineWidth: 0.5))
            )
            .padding(.horizontal, 20)
            .padding(.bottom, 16)

            ScrollView {
                VStack(spacing: 0) {
                    if selectedTab == 0 {
                        ForEach(Array(chats.enumerated()), id: \.element.id) { index, chat in
                            NavigationLink(value: Route.imChat(id: String(chat.id))) {
                                chatRow(chat)
                            }
                            if index < chats.count - 1 {
                                Divider().padding(.leading, 76)
                            }
                        }
                    } else {
                        ForEach(Array(contacts.enumerated()), id: \.element.id) { index, contact in
                            NavigationLink(value: Route.imChat(id: String(contact.id))) {
                                contactRow(contact)
                            }
                            if index < contacts.count - 1 {
                                Divider().padding(.leading, 68)
                            }
                        }
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(.white)
                        .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 32)
            }
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }

    private func chatRow(_ chat: ChatItem) -> some View {
        HStack(spacing: 16) {
            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(chat.type == "group" ? .blue : chat.type == "system" ? .orange : Color(.systemGray4))
                    .frame(width: 56, height: 56)
                    .overlay {
                        if chat.type == "group" {
                            Image(systemName: "person.2.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(.white)
                        } else {
                            Text(String(chat.name.prefix(1)))
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }

                if chat.unread > 0 {
                    Text("\(chat.unread)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(.red))
                        .offset(x: 6, y: -6)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(chat.name)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color(.label))
                    Spacer()
                    Text(chat.time)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color(.systemGray2))
                }
                Text(chat.message)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(.systemGray))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    private func contactRow(_ contact: ContactItem) -> some View {
        HStack(spacing: 16) {
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(contact.color)
                    .frame(width: 48, height: 48)
                    .overlay {
                        Text(String(contact.name.prefix(1)))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                    }
                Circle()
                    .fill(contact.status == "在线" ? .green : contact.status == "忙碌" ? .red : .gray)
                    .frame(width: 14, height: 14)
                    .overlay(Circle().stroke(.white, lineWidth: 2))
                    .offset(x: 4, y: 4)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color(.label))
                Text(contact.status)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(.systemGray))
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }
}
