
const SVG_NS = "http://www.w3.org/2000/svg";

export function renderWeeklyScreenChart(daily) {
  const mount = document.getElementById("weekly-screen-chart");
  if (!mount) return;

  mount.replaceChildren();

  const maxHours = Math.max(
    1,
    ...daily.map(d => d.screenMs / 3600000)
  );

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 350 190");
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Daily screen viewing hours over seven days"
  );

  daily.forEach((day, i) => {
    const hours = day.screenMs / 3600000;
    const height = (hours / maxHours) * 120;
    const x = 17 + i * 49;

    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", x);
    bar.setAttribute("y", 145 - height);
    bar.setAttribute("width", 28);
    bar.setAttribute("height", height);
    bar.setAttribute("rx", 6);
    bar.setAttribute("fill", "#57a7dd");
    svg.appendChild(bar);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x + 14);
    label.setAttribute("y", 164);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#a8cbe1");
    label.setAttribute("font-size", "11");

    label.textContent = new Date(
      `${day.date}T12:00:00`
    ).toLocaleDateString("en-US", {
      weekday: "short"
    });

    svg.appendChild(label);

    const value = document.createElementNS(SVG_NS, "text");
    value.setAttribute("x", x + 14);
    value.setAttribute("y", 138 - height);
    value.setAttribute("text-anchor", "middle");
    value.setAttribute("fill", "#e5f0fa");
    value.setAttribute("font-size", "10");
    value.textContent = `${hours.toFixed(1)}h`;
    svg.appendChild(value);
  });

  mount.appendChild(svg);
}
