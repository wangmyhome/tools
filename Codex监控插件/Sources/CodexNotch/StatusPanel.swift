import SwiftUI

struct StatusPanel: View {
    @ObservedObject var monitor: CodexMonitor
    @ObservedObject var state: NotchPanelState

    private var shownTasks: [CodexTask] {
        Array(monitor.recentTasks.prefix(2))
    }

    var body: some View {
        ZStack(alignment: .top) {
            statusPill

            expandedPanel
                .opacity(state.isExpanded ? 1 : 0)
                .scaleEffect(state.isExpanded ? 1 : 0.94, anchor: .top)
                .allowsHitTesting(state.isExpanded)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.spring(response: 0.34, dampingFraction: 0.82), value: state.isExpanded)
        .preferredColorScheme(.dark)
    }

    private var statusPill: some View {
        HStack(spacing: 8) {
            statusMark

            Text(monitor.activeTasks.isEmpty ? "空闲" : monitor.headline)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(
            Capsule(style: .continuous)
                .fill(Color(red: 0.07, green: 0.08, blue: 0.10).opacity(0.90))
                .overlay(Capsule(style: .continuous).strokeBorder(Color.white.opacity(0.10)))
        )
        .shadow(color: .black.opacity(0.22), radius: 12, y: 5)
        .contentShape(Capsule(style: .continuous))
    }

    @ViewBuilder
    private var statusMark: some View {
        if monitor.activeTasks.isEmpty {
            if let task = monitor.recentTasks.first, task.status == .completed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(red: 0.33, green: 0.84, blue: 0.45))
            } else if let task = monitor.recentTasks.first, task.status == .failed {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(red: 0.92, green: 0.32, blue: 0.35))
            } else {
                Circle()
                    .strokeBorder(Color.white.opacity(0.32), lineWidth: 2)
                    .frame(width: 11, height: 11)
            }
        } else {
            let phase = monitor.tick.timeIntervalSince1970.truncatingRemainder(dividingBy: 1.2) / 1.2
            let glow = 0.35 + phase * 0.65

            Circle()
                .strokeBorder(Color(red: 0.20, green: 0.84, blue: 0.90).opacity(glow), lineWidth: 2)
                .background(Circle().fill(Color(red: 0.20, green: 0.84, blue: 0.90).opacity(glow * 0.20)))
                .frame(width: 11, height: 11)
                .shadow(color: Color(red: 0.20, green: 0.84, blue: 0.90).opacity(glow * 0.55), radius: 2 + phase * 5)
        }
    }

    private var expandedPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(monitor.headline)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Spacer(minLength: 12)

                Text("最近任务")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.38))
            }

            VStack(spacing: 7) {
                if shownTasks.isEmpty {
                    Text("暂无任务记录")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.36))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 30)
                } else {
                    ForEach(shownTasks) { task in
                        CompactTaskRow(task: task, now: monitor.tick)
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 40)
        .padding(.bottom, 18)
        .frame(width: NotchPanelState.expandedSize.width, height: NotchPanelState.expandedSize.height, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(red: 0.09, green: 0.10, blue: 0.12).opacity(0.97))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.09))
                )
        )
        .shadow(color: .black.opacity(0.26), radius: 24, y: 10)
    }
}

struct CompactTaskRow: View {
    let task: CodexTask
    let now: Date

    var body: some View {
        HStack(spacing: 10) {
            statusIcon

            VStack(alignment: .leading, spacing: 3) {
                Text(task.displayName)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(1)
                    .truncationMode(.middle)

                Text(task.workingFolder)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.34))
                    .lineLimit(1)
                    .truncationMode(.head)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(task.statusLabel)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(task.color)

                Text(task.elapsed(now: now))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(task.isActive ? 0.72 : 0.42))
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.045))
        )
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var statusIcon: some View {
        if task.isActive {
            let phase = now.timeIntervalSince1970.truncatingRemainder(dividingBy: 1.2) / 1.2
            let glow = 0.35 + phase * 0.65

            Circle()
                .strokeBorder(Color(red: 0.20, green: 0.84, blue: 0.90).opacity(glow), lineWidth: 2)
                .frame(width: 10, height: 10)
        } else if task.status == .completed {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(red: 0.33, green: 0.84, blue: 0.45))
        } else if task.status == .failed {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(red: 0.92, green: 0.32, blue: 0.35))
        } else {
            Text(task.statusGlyph)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(task.color)
        }
    }
}
