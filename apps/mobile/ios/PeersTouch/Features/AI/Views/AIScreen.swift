import SwiftUI

struct AIChatScreen: View {
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)
    @State private var messageText = ""
    @State private var showAgentSelector = false
    
    struct ChatMessage: Identifiable {
        let id = UUID()
        let isUser: Bool
        let content: String
        let thinking: String?
    }
    
    @State private var messages: [ChatMessage] = [
        ChatMessage(isUser: true, content: "帮我写一个快速排序算法，用Python实现。", thinking: nil),
        ChatMessage(isUser: false, content: "当然，这是一个简洁的Python快速排序实现：\n\ndef quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quick_sort(left) + middle + quick_sort(right)", thinking: "1. 用户需要一个快速排序算法的Python实现。\n2. 快速排序的核心思想是分治法：选择基准值，分区，递归。\n3. 提供一个简洁易懂的实现版本。"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 20) {
                        ForEach(messages) { msg in
                            if msg.isUser {
                                userBubble(msg.content)
                            } else {
                                aiBubble(msg)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 24)
                    .padding(.bottom, 16)
                }
            }
            
            inputBar
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
        .sheet(isPresented: $showAgentSelector) {
            agentSelectorSheet
        }
    }
    
    private func userBubble(_ text: String) -> some View {
        HStack {
            Spacer(minLength: 60)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(brandPurple)
                )
                .clipShape(BubbleShape(isUser: true))
        }
    }
    
    private func aiBubble(_ msg: ChatMessage) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(brandPurple)
                    .frame(width: 32, height: 32)
                Image(systemName: "sparkles")
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
            }
            
            VStack(alignment: .leading, spacing: 10) {
                if let thinking = msg.thinking {
                    thinkingBlock(thinking)
                }
                
                Text(msg.content)
                    .font(.system(size: 15))
                    .foregroundStyle(Color(.label))
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.white)
                            .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                    )
            }
            
            Spacer(minLength: 40)
        }
    }
    
    private func thinkingBlock(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(.purple)
                Text("思考过程")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(.systemGray))
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 13))
                    .foregroundStyle(Color(.systemGray3))
            }
            
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(Color(.systemGray))
                .lineSpacing(4)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(brandPurple.opacity(0.2))
                        .frame(width: 2)
                }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.white)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(.systemGray5), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.03), radius: 2, y: 1)
        )
    }
    
    private var inputBar: some View {
        HStack(spacing: 6) {
            Button(action: { showAgentSelector = true }) {
                HStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(brandPurple)
                            .frame(width: 24, height: 24)
                        Image(systemName: "sparkles")
                            .font(.system(size: 12))
                            .foregroundStyle(.white)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(.systemGray))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(
                    Capsule()
                        .fill(Color(.systemGray6))
                        .overlay(Capsule().stroke(Color(.systemGray5), lineWidth: 0.5))
                )
            }
            
            TextField("发消息或按住说话...", text: $messageText)
                .font(.system(size: 14))
                .textFieldStyle(.plain)
            
            Button(action: {}) {
                Image(systemName: "plus.circle")
                    .font(.system(size: 22))
                    .foregroundStyle(Color(.systemGray))
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(.white)
                .shadow(color: .black.opacity(0.06), radius: 12, y: 2)
                .overlay(Capsule().stroke(Color(.systemGray5), lineWidth: 0.5))
        )
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
    
    private var agentSelectorSheet: some View {
        NavigationStack {
            List {
                ForEach(["Agent Box", "Agent Builder", "CLI Helper", "Coder", "Researcher", "Writer"], id: \.self) { name in
                    HStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(name == "Agent Box" ? brandPurple : Color(.systemGray4))
                                .frame(width: 48, height: 48)
                            Image(systemName: "sparkles")
                                .font(.system(size: 20))
                                .foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name)
                                .font(.system(size: 15, weight: .bold))
                            Text("你的AI助手")
                                .font(.system(size: 13))
                                .foregroundStyle(Color(.systemGray))
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("切换 Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showAgentSelector = false }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color(.systemGray3))
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

struct BubbleShape: Shape {
    let isUser: Bool
    func path(in rect: CGRect) -> Path {
        let radius: CGFloat = 16
        let smallRadius: CGFloat = 4
        var path = Path()
        if isUser {
            path.addRoundedRect(in: rect, cornerRadii: RectangleCornerRadii(topLeading: radius, bottomLeading: radius, bottomTrailing: radius, topTrailing: smallRadius))
        } else {
            path.addRoundedRect(in: rect, cornerRadii: RectangleCornerRadii(topLeading: smallRadius, bottomLeading: radius, bottomTrailing: radius, topTrailing: radius))
        }
        return path
    }
}
