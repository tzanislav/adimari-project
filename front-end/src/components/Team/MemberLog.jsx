import React, { useState, useEffect, useMemo } from "react";
import VerticalBar from "./LogBar";
import "../../CSS/Other/MemberLog.css";

/**
 * Visualises movement log entries in fixed‑width time frames.
 * – Newest day is rendered first; inside each day bars appear earliest → latest.
 * – Empty frames are kept so the timeline is uniform.
 * – Heavy calculations are memoised; network requests are abort‑safe.
 */

// Resolve API base URL from env (Vite, CRA) or fall back to hard‑coded value.
const API_BASE_URL =
  (typeof process !== "undefined" ? process.env.REACT_APP_API_URL : undefined) ||
  (typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_URL : undefined) ||
  "http://54.76.118.84:5001";

/**
 * @param {Object}   props
 * @param {string}   props.memberId     – id of the member to load
 * @param {number}   [props.incrementMs] – bucket size in ms (default 1 h)
 * @param {number}   [props.frames]      – how many buckets to draw (default 2 500)
 */
function MemberLog({ memberId, incrementMs = 60 * 60 * 1000, frames = 2500 }) {
  const [logData, setLogData] = useState([]);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // data fetching
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/activity/time-entries/${memberId}`,
          { signal: controller.signal }
        );
        const json = await res.json();

        // Pre‑convert timestamp to epoch (number) for faster math later
        setLogData(
          json.map((e) => ({
            ...e,
            epoch: new Date(e.timestamp).getTime(),
            movement: e.movement ?? 0,
          }))
        );
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Error fetching log data:", err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [memberId]);

  // ---------------------------------------------------------------------------
  // heavy calculation (memoised)
  // ---------------------------------------------------------------------------
  const { groupedBars, maxTotal } = useMemo(
    () => buildBars(logData, incrementMs, frames),
    [logData, incrementMs, frames]
  );

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  if (loading && !logData.length) return <div>Loading...</div>;

  return (
    <div className="member-log-wrapper-2">
      {groupedBars.map((group) => (
        <div key={group.date} className="day-group">
          <div className="log-date-label">{group.date}</div>
          <div className="member-log-container">
            {group.bars.map((bar) => {
              const time = new Date(bar.frameStart);
              const hour = time.getHours();
              const showHour = hour !== bar.prevHour;

              return (
                <VerticalBar
                  key={bar.frameStart}
                  fill={maxTotal ? bar.total / maxTotal : 0}
                  text={showHour ? `|${hour+1}` : ""}
                  details={time.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default MemberLog;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function buildBars(rawEntries, incrementMs, frames) {
  // Sort newest → oldest once so we can walk it linearly
  const entries = [...rawEntries].sort((a, b) => b.epoch - a.epoch);

  const bars = [];
  let maxTotal = 0;
  let pointer = Date.now();
  let idx = 0;

  for (let i = 0; i < frames; i++) {
    const frameEnd = pointer;
    const frameStart = pointer - incrementMs;

    let totalMovement = 0;
    // Consume all entries inside this frame
    while (idx < entries.length && entries[idx].epoch >= frameStart) {
      totalMovement += entries[idx].movement;
      idx++;
    }

    bars.push({ frameStart, total: totalMovement });
    if (totalMovement > maxTotal) maxTotal = totalMovement;

    pointer -= incrementMs;
  }

  // Group by day (newest‑first) and reverse each group so earliest bar is first
  const grouped = [];
  let currentDay = "";
  let dayGroup = [];

  for (const bar of bars) {
    const dateStr = new Date(bar.frameStart).toLocaleDateString();
    if (dateStr !== currentDay) {
      if (dayGroup.length)
        grouped.push({ date: currentDay, bars: dayGroup.reverse() });
      currentDay = dateStr;
      dayGroup = [];
    }
    const prevBar = dayGroup[dayGroup.length - 1];
    dayGroup.push({
      ...bar,
      prevHour: prevBar ? new Date(prevBar.frameStart).getHours() : null,
    });
  }
  if (dayGroup.length)
    grouped.push({ date: currentDay, bars: dayGroup.reverse() });

  return { groupedBars: grouped, maxTotal };
}