import SwiftUI

struct NotchSurface: View {
    @ObservedObject var monitor: CodexMonitor
    @ObservedObject var state: NotchPanelState

    private var shownTasks: [CodexTask] {
        Array(monitor.recentTasks.prefix(2))
    }

    var body: some View {
        VStack(spacing: 0) {
            notchHead

            if state.isExpanded {
                taskList
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(surface)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.easeInOut(duration: 0.16), value: state.isExpanded)
        .preferredColorScheme(.dark)
    }

    private var notchHead: some View {
        HStack(spacing: 8) {
            statusMark

            Text(monitor.activeTasks.isEmpty ? "空闲" : monitor.headline)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)

            Image(systemName: state.isExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(.white.opacity(0.32))
                .padding(.leading, 2)
        }
        .padding(.horizontal, 16)
        .frame(height: NotchPanelState.compactSize.height)
        .frame(maxWidth: state.isExpanded ? .infinity : NotchPanelState.compactSize.width)
        .animation(.easeInOut(duration: 0.16), value: state.isExpanded)
    }

    private var surface: some View {
        RoundedRectangle(cornerRadius: state.isExpanded ? 22 : 18, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: state.isExpanded ? 22 : 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.045), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.10), radius: 10, y: 4)
    }

    @ViewBuilder
    private var statusMark: some View {
        if monitor.activeTasks.isEmpty {
            if let task = monitor.recentTasks.first, task.displayStatus == .completed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(red: 0.28, green: 0.78, blue: 0.41))
            } else if let task = monitor.recentTasks.first, task.displayStatus == .failed {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(red: 0.90, green: 0.28, blue: 0.31))
            } else {
                Circle()
                    .strokeBorder(Color.white.opacity(0.28), lineWidth: 2)
                    .frame(width: 11, height: 11)
            }
        } else {
            RunningIndicator(diameter: 11)
        }
    }

    private var taskList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("最近任务")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.35))

                Spacer(minLength: 0)
            }

            if shownTasks.isEmpty {
                Text("暂无任务记录")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.34))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
            } else {
                ForEach(shownTasks) { task in
                    NotchTaskRow(task: task, now: monitor.tick)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
        .frame(width: NotchPanelState.expandedSize.width, alignment: .top)
    }
}

struct NotchTaskRow: View {
    let task: CodexTask
    let now: Date

    var body: some View {
        HStack(spacing: 10) {
            statusIcon

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(task.projectName)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.48))
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Text(task.questionPrefix)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.86))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                HStack(spacing: 5) {
                    Text(task.workingFolder)
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.28))
                        .lineLimit(1)
                        .truncationMode(.head)

                    if let message = task.errorMessage {
                        Text(message)
                            .font(.system(size: 9.5, design: .monospaced))
                            .foregroundStyle(task.color.opacity(0.65))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(task.statusLabel)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(task.color)

                Text(task.elapsed(now: now))
                    .font(.system(size: 9.5, design: .monospaced))
                    .foregroundStyle(.white.opacity(task.isActive ? 0.68 : 0.38))
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(Color.white.opacity(0.05))
        )
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var statusIcon: some View {
        if task.isActive {
            RunningIndicator(diameter: 10)
        } else if task.displayStatus == .completed {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(red: 0.28, green: 0.78, blue: 0.41))
        } else if task.displayStatus == .failed {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(red: 0.90, green: 0.28, blue: 0.31))
        } else {
            Text(task.statusGlyph)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(task.color)
        }
    }
}

private struct RunningIndicator: View {
    let diameter: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
            let timestamp = context.date.timeIntervalSinceReferenceDate
            let rotation = timestamp / 0.65
            let pulse = 0.5 + 0.5 * sin(timestamp * 2 * .pi / 0.42)

            ZStack {
                Circle()
                    .strokeBorder(rainbow, lineWidth: 2)
                    .opacity(0.34 + pulse * 0.28)
                    .scaleEffect(1.28)

                Circle()
                    .strokeBorder(rainbow, lineWidth: 2)
            }
            .frame(width: diameter, height: diameter)
            .rotationEffect(.degrees(rotation * 360))
        }
    }

    private var rainbow: AngularGradient {
        AngularGradient(
            colors: [
                Color(red: 0.18, green: 0.86, blue: 0.94),
                Color(red: 0.34, green: 0.52, blue: 1.00),
                Color(red: 0.70, green: 0.38, blue: 1.00),
                Color(red: 1.00, green: 0.32, blue: 0.58),
                Color(red: 1.00, green: 0.62, blue: 0.24),
                Color(red: 0.32, green: 0.92, blue: 0.58),
                Color(red: 0.18, green: 0.86, blue: 0.94)
            ],
            center: .center
        )
    }
}

