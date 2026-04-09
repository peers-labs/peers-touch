import SwiftUI

struct SettingsScreen: View {
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)

    struct MenuItem: Identifiable {
        let id = UUID()
        let icon: String
        let label: String
        let value: String?
        let active: Bool

        init(icon: String, label: String, value: String? = nil, active: Bool = false) {
            self.icon = icon
            self.label = label
            self.value = value
            self.active = active
        }
    }

    struct MenuGroup: Identifiable {
        let id = UUID()
        let title: String
        let items: [MenuItem]
    }

    private let menuGroups: [MenuGroup] = [
        MenuGroup(title: "核心配置", items: [
            MenuItem(icon: "sparkles", label: "Agent 设置", active: true),
            MenuItem(icon: "server.rack", label: "Providers", value: "9 个可用"),
            MenuItem(icon: "gearshape", label: "Model Service"),
            MenuItem(icon: "key.fill", label: "OAuth"),
            MenuItem(icon: "brain.head.profile", label: "Memory & Embedding"),
        ]),
        MenuGroup(title: "功能扩展", items: [
            MenuItem(icon: "wrench.fill", label: "Skills"),
            MenuItem(icon: "waveform", label: "Voice"),
            MenuItem(icon: "square.grid.2x2.fill", label: "Applets"),
        ]),
        MenuGroup(title: "系统", items: [
            MenuItem(icon: "gearshape.fill", label: "General"),
            MenuItem(icon: "doc.text.fill", label: "Logs"),
            MenuItem(icon: "questionmark.circle.fill", label: "Help & About"),
        ]),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("设置")
                    .font(.system(size: 34, weight: .bold))
                    .padding(.top, 56)

                profileCard

                ForEach(menuGroups) { group in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(group.title)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color(.systemGray2))
                            .textCase(.uppercase)
                            .tracking(1)
                            .padding(.leading, 8)

                        VStack(spacing: 0) {
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                menuRow(item)
                                if index < group.items.count - 1 {
                                    Divider().padding(.leading, 56)
                                }
                            }
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 24)
                                .fill(.white)
                                .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                        )
                    }
                }

                Button(action: {}) {
                    Text("退出登录")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 24)
                                .fill(.white)
                                .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                        )
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }

    private var profileCard: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(brandPurple)
                    .frame(width: 64, height: 64)
                    .shadow(color: brandPurple.opacity(0.3), radius: 6, y: 3)
                Text("A")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Agent Box User")
                    .font(.system(size: 20, weight: .bold))
                Text("Free Plan")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(.systemGray))
            }

            Spacer()

            ZStack {
                Circle()
                    .fill(Color(.systemGray6))
                    .frame(width: 40, height: 40)
                Image(systemName: "chevron.right")
                    .font(.system(size: 16))
                    .foregroundStyle(Color(.systemGray2))
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(.white)
                .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
        )
    }

    private func menuRow(_ item: MenuItem) -> some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(item.active ? brandPurple.opacity(0.1) : Color(.systemGray6))
                    .frame(width: 40, height: 40)
                Image(systemName: item.icon)
                    .font(.system(size: 18))
                    .foregroundStyle(item.active ? brandPurple : Color(.systemGray))
            }

            Text(item.label)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(.label))

            Spacer()

            if let value = item.value {
                Text(value)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color(.systemGray2))
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundStyle(Color(.systemGray3))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }
}
