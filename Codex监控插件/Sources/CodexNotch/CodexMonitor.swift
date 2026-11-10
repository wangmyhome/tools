import Foundation
import SQLite3
import SwiftUI
import UserNotifications

enum TaskStatus: String {
    case inProgress = "inProgress"
    case completed
    case failed
    case interrupted
}

struct CodexTask: Identifiable, Equatable {
    let id: String
    let threadTitle: String
    let cwd: String
    let status: TaskStatus
    let startedAt: Date?
    let completedAt: Date?
    let durationMs: Int64?
    let lastActivityAt: Date?
    let errorMessage: String?

    var displayName: String {
        let value = threadTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { return value }
        let folder = (cwd as NSString).lastPathComponent
        return folder.isEmpty ? "Codex 任务" : folder
    }

    var isInternalReview: Bool {
        threadTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare("Guardian review") == .orderedSame
    }

    var projectName: String {
        let folder = (cwd as NSString).lastPathComponent
        return folder.isEmpty ? "Codex" : folder
    }

    var questionPrefix: String {
        let lines = threadTitle
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: true)

        for line in lines {
            let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty || value.hasPrefix("#") || value.hasPrefix("```") || value.count < 4 {
                continue
            }
            return value
        }

        return displayName
    }

    var workingFolder: String {
        (cwd as NSString).lastPathComponent
    }

    var endedAt: Date? {
        completedAt ?? startedAt
    }

    var isActive: Bool {
        guard status == .inProgress, let lastActivityAt else { return false }
        return Date().timeIntervalSince(lastActivityAt) < 90
    }

    var displayStatus: TaskStatus {
        status == .inProgress && !isActive ? .completed : status
    }

    var statusGlyph: String {
        switch displayStatus {
        case .inProgress: return "●"
        case .completed: return "✓"
        case .failed: return "!"
        case .interrupted: return "‖"
        }
    }

    var statusLabel: String {
        switch displayStatus {
        case .inProgress: return "执行中"
        case .completed: return "已完成"
        case .failed: return "失败"
        case .interrupted: return "已中断"
        }
    }

    var color: Color {
        switch displayStatus {
        case .inProgress: return Color(red: 0.20, green: 0.84, blue: 0.90)
        case .completed: return Color(red: 0.33, green: 0.84, blue: 0.45)
        case .failed: return Color(red: 0.92, green: 0.32, blue: 0.35)
        case .interrupted: return Color(red: 0.95, green: 0.64, blue: 0.25)
        }
    }

    func elapsed(now: Date) -> String {
        if isActive, let startedAt {
            return timeString(now.timeIntervalSince(startedAt))
        }
        if displayStatus == .completed, durationMs == nil, let startedAt, let lastActivityAt {
            return timeString(lastActivityAt.timeIntervalSince(startedAt))
        }
        if let durationMs {
            return timeString(Double(durationMs) / 1000)
        }
        if let startedAt, let completedAt {
            return timeString(completedAt.timeIntervalSince(startedAt))
        }
        return "--"
    }

    private func timeString(_ interval: TimeInterval) -> String {
        let value = max(0, Int(interval))
        if value >= 3600 {
            return String(format: "%d:%02d:%02d", value / 3600, value % 3600 / 60, value % 60)
        }
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}

enum TaskFilter: String, CaseIterable, Identifiable {
    case active = "活动"
    case recent = "全部"

    var id: String { rawValue }
}

@MainActor
final class CodexMonitor: ObservableObject {
    @Published var tasks: [CodexTask] = []
    @Published var tick = Date()
    @Published var recentCompletion: CodexTask?

    private var timer: Timer?
    private var previousActiveIDs: Set<String> = []

    var activeTasks: [CodexTask] {
        userVisibleTasks.filter { $0.isActive }
    }

    var recentTasks: [CodexTask] {
        userVisibleTasks
    }

    var userVisibleTasks: [CodexTask] {
        tasks.filter { !$0.isInternalReview }
    }

    var statusGlyph: String {
        if activeTasks.contains(where: { $0.status == .failed }) { return "!" }
        if !activeTasks.isEmpty { return "●" }
        if let completion = recentCompletion, abs(completion.endedAt?.timeIntervalSinceNow ?? 0) < 30 {
            return "✓"
        }
        return "○"
    }

    var headline: String {
        let count = activeTasks.count
        return count == 0 ? "空闲" : "\(count) 个任务执行中"
    }

    var menuBarTitle: String {
        let count = activeTasks.count
        return count == 0 ? "○ Codex" : "● \(count) Codex"
    }

    func start() {
        reload()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.reload()
                self?.tick = Date()
            }
        }
    }

    func reload() {
        let loaded = Self.readTasks(limit: 7)
        let visibleTasks = loaded.filter { !$0.isInternalReview }
        let activeIDs = Set(visibleTasks.filter { $0.isActive }.map(\.id))

        for id in previousActiveIDs where !activeIDs.contains(id) {
            if let task = loaded.first(where: { $0.id == id }) {
                announce(task)
            }
        }

        previousActiveIDs = activeIDs
        tasks = loaded
    }

    private func announce(_ task: CodexTask) {
        guard task.status != .inProgress else { return }
        recentCompletion = task
        NSSound(named: "Glass")?.play()
        deliverNotification(task)
    }

    private func deliverNotification(_ task: CodexTask) {
        let center = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        content.title = task.status == .failed ? "Codex 任务失败" : "Codex 任务完成"
        content.body = task.displayName
        content.sound = .default
        let request = UNNotificationRequest(identifier: task.id, content: content, trigger: nil)
        center.add(request)
    }

    nonisolated private static func readTasks(limit: Int) -> [CodexTask] {
        let databasePath = NSString(string: "~/.codex/thread_history_1.sqlite").expandingTildeInPath
        let statePath = NSString(string: "~/.codex/state_5.sqlite").expandingTildeInPath
        var database: OpaquePointer?
        guard sqlite3_open_v2(databasePath, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            diagnosticLog("open failed: \(databasePath)")
            sqlite3_close(database)
            return []
        }
        defer { sqlite3_close(database) }

        sqlite3_busy_timeout(database, 500)
        if sqlite3_exec(database, "ATTACH DATABASE '\(statePath)' AS state;", nil, nil, nil) != SQLITE_OK {
            diagnosticLog("attach failed: \(sqlite3_errmsg(database).map { String(cString: $0) } ?? "unknown")")
            return []
        }

        let query = """
        WITH ranked AS (
            SELECT thread_id, turn_id, status, started_at, completed_at, duration_ms, error_json,
                   ROW_NUMBER() OVER (
                       PARTITION BY thread_id
                       ORDER BY COALESCE(completed_at, started_at, 0) DESC, turn_id DESC
                   ) AS rank
            FROM thread_turns
        )
        SELECT ranked.thread_id, ranked.turn_id,
               COALESCE(
                   NULLIF(threads.title, ''),
                   NULLIF((
                       SELECT json_extract(user_item.item_json, '$.content[0].text')
                       FROM thread_items user_item
                       WHERE user_item.thread_id = ranked.thread_id
                         AND user_item.item_type = 'userMessage'
                       ORDER BY user_item.created_at_ms DESC, user_item.rollout_ordinal DESC
                       LIMIT 1
                   ), ''),
                   'Codex 任务'
               ) AS title,
               threads.cwd, ranked.status,
               ranked.started_at, ranked.completed_at, ranked.duration_ms, ranked.error_json,
               COALESCE((
                   SELECT MAX(thread_items.created_at_ms)
                   FROM thread_items
                   WHERE thread_items.thread_id = ranked.thread_id
               ), 0) AS last_activity_ms
        FROM ranked
        LEFT JOIN threads ON threads.id = ranked.thread_id
        WHERE ranked.rank = 1
        ORDER BY CASE
                    WHEN ranked.status = 'inProgress'
                     AND last_activity_ms > (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 90000)
                    THEN 0 ELSE 1
                 END,
                 last_activity_ms DESC,
                 COALESCE(ranked.completed_at, ranked.started_at, 0) DESC
        LIMIT ?;
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK else {
            diagnosticLog("prepare failed: \(sqlite3_errmsg(database).map { String(cString: $0) } ?? "unknown")")
            return []
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int(statement, 1, Int32(limit))

        var result: [CodexTask] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let threadID = string(statement, 0)
            let turnID = string(statement, 1)
            let title = string(statement, 2)
            let cwd = string(statement, 3)
            let statusRaw = string(statement, 4)
            let started = sqlite3_column_type(statement, 5) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 5))
            let completed = sqlite3_column_type(statement, 6) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 6))
            let duration = sqlite3_column_type(statement, 7) == SQLITE_NULL ? nil : Int64(sqlite3_column_int64(statement, 7))
            let errorJSON = string(statement, 8)
            let lastActivityMs = sqlite3_column_int64(statement, 9)
            let lastActivity = lastActivityMs > 0 ? Date(timeIntervalSince1970: Double(lastActivityMs) / 1000) : nil

            result.append(CodexTask(
                id: "\(threadID):\(turnID)",
                threadTitle: title,
                cwd: cwd,
                status: TaskStatus(rawValue: statusRaw) ?? .completed,
                startedAt: started,
                completedAt: completed,
                durationMs: duration,
                lastActivityAt: lastActivity,
                errorMessage: errorJSON.isEmpty ? nil : errorJSON
            ))
        }
        diagnosticLog("loaded \(result.count) tasks, active \(result.filter { $0.isActive }.count)")
        return result
    }

    nonisolated private static func diagnosticLog(_ message: String) {
        let line = "\(DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)) \(message)\n"
        let path = "/tmp/codexnotch.log"
        if let handle = FileHandle(forWritingAtPath: path) {
            defer { try? handle.close() }
            try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
        } else {
            try? Data(line.utf8).write(to: URL(fileURLWithPath: path))
        }
    }

    nonisolated private static func string(_ statement: OpaquePointer?, _ index: Int32) -> String {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else { return "" }
        if let text = sqlite3_column_text(statement, index) {
            return String(cString: text)
        }
        return ""
    }
}
