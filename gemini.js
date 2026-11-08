
const WORKER_URL =
    "https://headcloud-api.headcloud-dev.workers.dev";

export async function generateWeeklyInsights(week) {
    if (
        !week ||
        !Array.isArray(week.daily) ||
        week.daily.length !== 7
    ) {
        throw new Error(
            "Expected seven days of statistics."
        );
    }

    const daily = week.daily.map(day => ({
        date: day.date,
        screenMs: day.screenMs,
        awayMs: day.awayMs,
        breaks: day.breaks
    }));

    const response = await fetch(
        `${WORKER_URL}/summary`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ daily })
        }
    );

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            "The server returned an invalid response."
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            `Request failed: ${response.status}`
        );
    }

    if (typeof data.summary !== "string") {
        throw new Error(
            "The server returned no summary."
        );
    }

    return data.summary;
}
