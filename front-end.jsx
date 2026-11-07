import { useState, useEffect } from "react";
import "./App.css";

const modes = {
  Focus: 25,
  "Short Break": 5,
  "Long Break": 15,
};

export default function App() {
  const [mode, setMode] = useState("Focus");
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [endTime, setEndTime] = useState(null);

  useEffect(() => {
    if (!running || !endTime) return;

    const interval = setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((endTime - Date.now()) / 1000)
      );

      setSeconds(left);

      if (left === 0) {
        setRunning(false);
        setEndTime(null);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [running, endTime]);

  function toggleTimer() {
    if (running) {
      setSeconds(Math.max(0,
        Math.ceil((endTime - Date.now()) / 1000)
      ));
      setRunning(false);
      setEndTime(null);
    } else {
      const time = seconds || modes[mode] * 60;
      setSeconds(time);
      setEndTime(Date.now() + time * 1000);
      setRunning(true);
    }
  }

  function resetTimer() {
    setRunning(false);
    setEndTime(null);
    setSeconds(modes[mode] * 60);
  }

  function changeMode(newMode) {
    setMode(newMode);
    setRunning(false);
    setEndTime(null);
    setSeconds(modes[newMode] * 60);
  }

  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  const total = modes[mode] * 60;
  const progress = seconds / total;

  return (
    <div className="timer-app">
      <h1>◷ Focus Timer</h1>
      <p className="subtitle">Make every minute count.</p>

      <div className="modes">
        {Object.keys(modes).map((item) => (
          <button
            key={item}
            className={mode === item ? "selected" : ""}
            onClick={() => changeMode(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div
        className="clock"
        style={{ "--progress": `${progress * 100}%` }}
      >
        <div className="clock-inner">
          <div className="time">{minutes}:{secs}</div>
          <span>{running ? "STAY FOCUSED" : "READY TO FOCUS"}</span>
        </div>
      </div>

      <div className="controls">
        <button className="start" onClick={toggleTimer}>
          {running ? "Ⅱ Pause" : "▶ Start"}
        </button>

        <button className="reset" onClick={resetTimer}>
          ↺ Reset
        </button>
      </div>

      <p className="footer">Stay focused. One session at a time.</p>
    </div>
  );
}
