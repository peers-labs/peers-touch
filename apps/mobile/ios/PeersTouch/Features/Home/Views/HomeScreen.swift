import SwiftUI

struct HomeScreen: View {
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)
    
    struct PinnedItem: Identifiable {
        let id: Int
        let name: String
        let type: String
        let icon: String
        let color: Color
    }
    
    struct TrackingItem: Identifiable {
        let id: Int
        let title: String
        let desc: String
        let color: Color
        let height: CGFloat
    }
    
    private let pinnedItems: [PinnedItem] = [
        PinnedItem(id: 1, name: "Agent Pilot", type: "Agent", icon: "cpu", color: .blue),
        PinnedItem(id: 2, name: "Web Search", type: "小程序", icon: "globe", color: .indigo),
        PinnedItem(id: 3, name: "张三", type: "人员", icon: "person.fill", color: .green),
        PinnedItem(id: 4, name: "Code Review", type: "Agent", icon: "chevron.left.forwardslash.chevron.right", color: .purple),
        PinnedItem(id: 5, name: "Data Sync", type: "小程序", icon: "arrow.triangle.2.circlepath", color: .teal),
    ]
    
    private let trackingItems: [TrackingItem] = [
        TrackingItem(id: 1, title: "服务器监控", desc: "CPU使用率 85%，内存 60%", color: Color(.systemRed).opacity(0.08), height: 128),
        TrackingItem(id: 2, title: "项目进度", desc: "前端重构已完成 80%", color: Color(.systemBlue).opacity(0.08), height: 160),
        TrackingItem(id: 3, title: "待办事项", desc: "下午 3 点产品评审会议", color: Color(.systemYellow).opacity(0.08), height: 112),
        TrackingItem(id: 4, title: "API 状态", desc: "所有服务运行正常", color: Color(.systemGreen).opacity(0.08), height: 144),
    ]
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                searchBar
                pinnedSection
                trackingSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 32)
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }
    
    private var searchBar: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.white)
                    .frame(width: 32, height: 32)
                    .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16))
                    .foregroundStyle(Color(.systemGray))
            }
            Text("搜索对话、工具、帮助...")
                .font(.system(size: 15))
                .foregroundStyle(Color(.systemGray2))
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 18))
                    .foregroundStyle(Color(.systemGray))
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemGray6))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(.systemGray5), lineWidth: 1)
                )
        )
    }
    
    private var pinnedSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                ZStack {
                    Circle()
                        .fill(brandPurple.opacity(0.1))
                        .frame(width: 32, height: 32)
                    Image(systemName: "pin.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(brandPurple)
                }
                Spacer()
                ZStack {
                    Circle()
                        .fill(Color(.systemGray6))
                        .frame(width: 32, height: 32)
                    Image(systemName: "gearshape")
                        .font(.system(size: 14))
                        .foregroundStyle(Color(.systemGray))
                }
            }
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(pinnedItems) { item in
                        VStack(spacing: 0) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(item.color)
                                    .frame(width: 56, height: 56)
                                    .shadow(color: item.color.opacity(0.3), radius: 4, y: 2)
                                Image(systemName: item.icon)
                                    .font(.system(size: 24, weight: .semibold))
                                    .foregroundStyle(.white)
                            }
                            .overlay(alignment: .bottomTrailing) {
                                Text(item.type)
                                    .font(.system(size: 9, weight: .bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(
                                        Capsule()
                                            .fill(badgeColor(for: item.type).opacity(0.15))
                                            .overlay(
                                                Capsule()
                                                    .stroke(badgeColor(for: item.type).opacity(0.3), lineWidth: 0.5)
                                            )
                                    )
                                    .foregroundStyle(badgeColor(for: item.type))
                                    .offset(x: 4, y: 8)
                            }
                        }
                        .padding(.bottom, 12)
                    }
                }
                .padding(.horizontal, 4)
            }
        }
    }
    
    private func badgeColor(for type: String) -> Color {
        switch type {
        case "Agent": return .blue
        case "小程序": return .indigo
        default: return .green
        }
    }
    
    private var trackingSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                ZStack {
                    Circle()
                        .fill(Color(.systemBlue).opacity(0.1))
                        .frame(width: 32, height: 32)
                    Image(systemName: "waveform.path.ecg")
                        .font(.system(size: 14))
                        .foregroundStyle(.blue)
                }
                Spacer()
                ZStack {
                    Circle()
                        .fill(Color(.systemGray6))
                        .frame(width: 32, height: 32)
                    Image(systemName: "gearshape")
                        .font(.system(size: 14))
                        .foregroundStyle(Color(.systemGray))
                }
            }
            
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 16) {
                    ForEach(trackingItems.filter { $0.id % 2 == 1 }) { item in
                        trackingCard(item)
                    }
                }
                VStack(spacing: 16) {
                    ForEach(trackingItems.filter { $0.id % 2 == 0 }) { item in
                        trackingCard(item)
                    }
                }
            }
        }
    }
    
    private func trackingCard(_ item: TrackingItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(item.title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(.label))
            Spacer()
            Text(item.desc)
                .font(.system(size: 13))
                .foregroundStyle(Color(.secondaryLabel))
                .lineSpacing(2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: item.height, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(item.color)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(.systemGray5), lineWidth: 0.5)
                )
        )
    }
}
