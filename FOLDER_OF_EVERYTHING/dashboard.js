
import { generateWeeklyInsights } from "./gemini.js";

// =====================================================
// DEFAULT STATISTICS
// =====================================================

const DEFAULT_STATS = {
    screenMs: 0,
    awayMs: 0,
    breaks: 0,
    longestScreenMs: 0
};

// =====================================================
// DATE HELPERS
// =====================================================

// Use local dates rather than UTC.
// This keeps dashboard dates consistent with stats.js.
function formatLocalDate(date) {
    const year = date.getFullYear();

    const month = String(
        date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// =====================================================
// FORMATTING HELPERS
// =====================================================

function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (ms > 0 && totalMinutes === 0) {
        return "<1m";
    }

    return `${minutes}m`;
}

function formatMinutes(ms) {
    return `${(ms / 60000).toFixed(1)} min`;
}

function formatBreakRate(breaks, screenMs) {
    const screenHours = screenMs / 3600000;

    if (screenHours <= 0) {
        return "0";
    }

    return (breaks / screenHours).toFixed(1);
}

// Safely update a dashboard element by ID.
function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

// =====================================================
// READ STORED STATISTICS
// =====================================================

async function getTodayStatistics() {
    const today = formatLocalDate(new Date());

    const key = `eyeease-stats-${today}`;

    const saved = await chrome.storage.local.get(key);

    return {
        ...DEFAULT_STATS,
        ...(saved[key] || {})
    };
}

async function getWeeklyStatistics() {
    const dates = [];

    // Today and the preceding six calendar days.
    for (let i = 6; i >= 0; i--) {
        const date = new Date();

        // Noon avoids some daylight-saving edge cases.
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - i);

        dates.push(formatLocalDate(date));
    }

    const keys = dates.map(
        date => `eyeease-stats-${date}`
    );

    // Retrieve all seven dates at once.
    const saved = await chrome.storage.local.get(keys);

    const daily = dates.map((date, index) => {
        const stats = {
            ...DEFAULT_STATS,
            ...(saved[keys[index]] || {})
        };

        return {
            date,
            ...stats
        };
    });

    // Calculate weekly totals.
    const totals = daily.reduce(
        (total, day) => {
            total.screenMs += day.screenMs;
            total.awayMs += day.awayMs;
            total.breaks += day.breaks;

            total.longestScreenMs = Math.max(
                total.longestScreenMs,
                day.longestScreenMs
            );

            return total;
        },
        { ...DEFAULT_STATS }
    );

    return { daily, totals };
}

// =====================================================
// RENDER TODAY'S STATISTICS
// =====================================================

function renderTodayStatistics(stats) {
    setText(
        "today-screen-time",
        formatDuration(stats.screenMs)
    );

    setText(
        "today-away-time",
        formatDuration(stats.awayMs)
    );

    setText(
        "today-break-count",
        String(stats.breaks)
    );

    setText(
        "today-longest-session",
        formatDuration(stats.longestScreenMs)
    );
}

// =====================================================
// RENDER WEEKLY STATISTICS
// =====================================================

function renderWeeklyStatistics(week) {
    const { totals } = week;

    setText(
        "weekly-screen-time",
        formatDuration(totals.screenMs)
    );

    setText(
        "weekly-away-time",
        formatDuration(totals.awayMs)
    );

    setText(
        "weekly-break-count",
        String(totals.breaks)
    );

    setText(
        "weekly-break-rate",
        formatBreakRate(
            totals.breaks,
            totals.screenMs
        )
    );
}

// =====================================================
// RENDER DAILY ACTIVITY TABLE
// =====================================================

function renderDailyTable(daily) {
    const tbody = document.getElementById(
        "weekly-table-body"
    );

    if (!tbody) return;

    // Remove old table rows.
    tbody.replaceChildren();

    for (const day of daily) {
        const row = document.createElement("tr");

        const values = [
            day.date,
            formatDuration(day.screenMs),
            formatDuration(day.awayMs),
            String(day.breaks)
        ];

        for (const value of values) {
            const cell = document.createElement("td");

            cell.textContent = value;
            row.appendChild(cell);
        }

        tbody.appendChild(row);
    }
}

// =====================================================
// REFRESH ENTIRE DASHBOARD
// =====================================================

async function renderDashboard() {
    const [today, week] = await Promise.all([
        getTodayStatistics(),
        getWeeklyStatistics()
    ]);

    renderTodayStatistics(today);

    renderWeeklyStatistics(week);

    renderDailyTable(week.daily);

    setText(
        "last-updated",
        `Last updated: ${new Date().toLocaleTimeString()}`
    );
}

// =====================================================
// GEMINI WEEKLY SUMMARY
// =====================================================

const summaryButton = document.getElementById(
    "generate-insights"
);

const summaryStatus = document.getElementById(
    "ai-status"
);

const summaryOutput = document.getElementById(
    "ai-insights"
);

if (summaryButton) {
    summaryButton.addEventListener("click", async () => {
        summaryButton.disabled = true;

        setText(
            "ai-status",
            "Generating your weekly summary..."
        );

        if (summaryOutput) {
            summaryOutput.textContent = "";
        }

        try {
            // Retrieve the latest stored statistics.
            const week = await getWeeklyStatistics();

            const hasTrackingData = week.daily.some(
                day =>
                    day.screenMs > 0 ||
                    day.awayMs > 0 ||
                    day.breaks > 0
            );

            if (!hasTrackingData) {
                setText(
                    "ai-status",
                    "No tracking data is available for this week."
                );

                return;
            }

            // gemini.js sends statistics to Cloudflare.
            const summary = await generateWeeklyInsights(
                week
            );

            if (summaryOutput) {
                summaryOutput.textContent = summary;
            }

            setText(
                "ai-status",
                "Weekly summary generated successfully."
            );

        } catch (error) {
            console.error(
                "Gemini summary failed:",
                error
            );

            setText(
                "ai-status",
                "Could not generate the summary."
            );

            if (summaryOutput) {
                summaryOutput.textContent =
                    error.message;
            }

        } finally {
            summaryButton.disabled = false;
        }
    });
}

// =====================================================
// AUTOMATIC UPDATES
// =====================================================

// Initial page load.
renderDashboard().catch(error => {
    console.error("Dashboard load failed:", error);

    setText(
        "last-updated",
        "Could not load statistics."
    );
});

// Update when tracker.js saves new statistics.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    const hasStatsChange = Object.keys(changes).some(
        key => key.startsWith("eyeease-stats-")
    );

    if (hasStatsChange) {
        renderDashboard().catch(console.error);
    }
});

// Refresh when the dashboard becomes visible again.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        renderDashboard().catch(console.error);
    }
});
