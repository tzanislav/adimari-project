import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../CSS/StairCalculator.css';

const IDEAL_SLOPE = 630;
const MIN_IDEAL_SLOPE = 620;
const MAX_IDEAL_SLOPE = 640;

const roundToTenth = (value) => Math.round(value * 10) / 10;

function StairCalculator() {
  const [rise, setRise] = useState(160);
  const [tread, setTread] = useState(310);
  const [steps, setSteps] = useState(16);
  const [floorHeight, setFloorHeight] = useState(2.56);

  const slope = (2 * rise) + tread;
  const slopeStatus = slope >= MIN_IDEAL_SLOPE && slope <= MAX_IDEAL_SLOPE;
  const totalRise = rise * steps;
  const totalRun = tread * steps;
  const drawing = { width: 1000, height: 460, left: 92, right: 60, top: 48, bottom: 88 };
  const drawingScale = Math.min(
    (drawing.width - drawing.left - drawing.right - 120) / totalRun,
    (drawing.height - drawing.top - drawing.bottom) / totalRise,
  );
  const stairStart = { x: drawing.left, y: drawing.height - drawing.bottom };
  const stairCommands = Array.from({ length: steps }, (_, index) => {
    const x = stairStart.x + ((index + 1) * tread * drawingScale);
    const y = stairStart.y - ((index + 1) * rise * drawingScale);
    return `H ${x} V ${y}`;
  }).join(' ');
  const stairEnd = {
    x: stairStart.x + (totalRun * drawingScale),
    y: stairStart.y - (totalRise * drawingScale),
  };

  function handleRiseChange(event) {
    const nextRise = Number(event.target.value);
    if (!Number.isFinite(nextRise) || nextRise <= 0) return;

    setRise(nextRise);
    setTread(roundToTenth(IDEAL_SLOPE - (2 * nextRise)));
    setFloorHeight(roundToTenth((nextRise * steps) / 1000));
  }

  function handleTreadChange(event) {
    const nextTread = Number(event.target.value);
    if (!Number.isFinite(nextTread) || nextTread <= 0) return;

    const nextRise = roundToTenth((IDEAL_SLOPE - nextTread) / 2);
    if (nextRise <= 0) return;

    setTread(nextTread);
    setRise(nextRise);
    setFloorHeight(roundToTenth((nextRise * steps) / 1000));
  }

  function handleStepsChange(event) {
    const nextSteps = Math.round(Number(event.target.value));
    if (!Number.isFinite(nextSteps) || nextSteps < 1) return;

    setSteps(nextSteps);
    setRise(roundToTenth((floorHeight * 1000) / nextSteps));
  }

  function handleFloorHeightChange(event) {
    const nextFloorHeight = Number(event.target.value);
    if (!Number.isFinite(nextFloorHeight) || nextFloorHeight <= 0) return;

    const nextSteps = Math.max(1, Math.round((nextFloorHeight * 1000) / rise));
    const nextRise = roundToTenth((nextFloorHeight * 1000) / nextSteps);

    setFloorHeight(nextFloorHeight);
    setSteps(nextSteps);
    setRise(nextRise);
    setTread(roundToTenth(IDEAL_SLOPE - (2 * nextRise)));
  }

  return (
    <main className="stair-calculator">
      <Link className="stair-calculator-back" to="/projects">← Back to projects</Link>
      <header className="stair-calculator-heading">
        <p className="stair-calculator-eyebrow">Project</p>
        <h1>Stair Calculator</h1>
        <p>Find comfortable step proportions using the ideal slope: 2 × rise + tread = 62–64 cm.</p>
      </header>

      <section className="stair-calculator-card" aria-label="Stair dimensions">
        <div className="stair-calculator-fields">
          <label>
            Step height (rise)
            <span className="stair-calculator-input">
              <input type="number" min="1" step="0.1" value={rise} onChange={handleRiseChange} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Step depth (tread)
            <span className="stair-calculator-input">
              <input type="number" min="1" step="0.1" value={tread} onChange={handleTreadChange} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Total number of steps
            <span className="stair-calculator-input">
              <input type="number" min="1" step="1" value={steps} onChange={handleStepsChange} />
              <span>steps</span>
            </span>
          </label>
          <label>
            Floor-to-floor height
            <span className="stair-calculator-input">
              <input type="number" min="0.01" step="0.01" value={floorHeight} onChange={handleFloorHeightChange} />
              <span>m</span>
            </span>
          </label>
        </div>

        <div className="stair-calculator-result" aria-live="polite">
          <p>Calculated slope</p>
          <strong>{roundToTenth(slope)} mm</strong>
          <span className={slopeStatus ? 'is-ideal' : 'is-outside-ideal'}>
            {slopeStatus ? 'Within the ideal 620–640 mm range' : 'Outside the ideal 620–640 mm range'}
          </span>
        </div>
      </section>

      <section className="stair-schematic" aria-labelledby="stair-schematic-title">
        <div className="stair-schematic-heading">
          <div>
            <p className="stair-calculator-eyebrow">Side view</p>
            <h2 id="stair-schematic-title">Stair schematic</h2>
          </div>
          <p>{steps} steps · {roundToTenth(rise)} mm rise · {roundToTenth(tread)} mm tread</p>
        </div>
        <svg
          className="stair-schematic-drawing"
          viewBox={`0 0 ${drawing.width} ${drawing.height}`}
          role="img"
          aria-label={`Side view of ${steps} stairs with a ${roundToTenth(rise)} millimetre rise and ${roundToTenth(tread)} millimetre tread`}
        >
          <defs>
            <marker id="dimension-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path
            className="stair-schematic-fill"
            d={`M ${stairStart.x} ${stairStart.y} ${stairCommands} L ${stairEnd.x} ${stairStart.y} Z`}
          />
          <path className="stair-schematic-steps" d={`M ${stairStart.x} ${stairStart.y} ${stairCommands}`} />
          <line className="stair-schematic-floor" x1="46" y1={stairStart.y} x2={stairEnd.x + 28} y2={stairStart.y} />
          <line className="stair-schematic-landing" x1={stairEnd.x} y1={stairEnd.y} x2={drawing.width - 46} y2={stairEnd.y} />
          <line className="stair-schematic-extension" x1={stairStart.x} y1={stairStart.y + 8} x2={stairStart.x} y2={stairStart.y + 50} />
          <line className="stair-schematic-extension" x1={stairEnd.x} y1={stairStart.y + 8} x2={stairEnd.x} y2={stairStart.y + 50} />
          <line
            className="stair-schematic-dimension"
            x1={stairStart.x + 7}
            y1={stairStart.y + 38}
            x2={stairEnd.x - 7}
            y2={stairStart.y + 38}
            markerStart="url(#dimension-arrow)"
            markerEnd="url(#dimension-arrow)"
          />
          <text className="stair-schematic-label" x={(stairStart.x + stairEnd.x) / 2} y={stairStart.y + 66} textAnchor="middle">
            {roundToTenth(totalRun / 1000)} m total run
          </text>
          <line className="stair-schematic-extension" x1={stairStart.x - 8} y1={stairStart.y} x2={stairStart.x - 56} y2={stairStart.y} />
          <line className="stair-schematic-extension" x1={stairStart.x - 8} y1={stairEnd.y} x2={stairStart.x - 56} y2={stairEnd.y} />
          <line
            className="stair-schematic-dimension"
            x1={stairStart.x - 38}
            y1={stairStart.y - 7}
            x2={stairStart.x - 38}
            y2={stairEnd.y + 7}
            markerStart="url(#dimension-arrow)"
            markerEnd="url(#dimension-arrow)"
          />
          <text className="stair-schematic-label" x={stairStart.x - 58} y={(stairStart.y + stairEnd.y) / 2} textAnchor="middle" transform={`rotate(-90 ${stairStart.x - 58} ${(stairStart.y + stairEnd.y) / 2})`}>
            {roundToTenth(totalRise / 1000)} m total rise
          </text>
        </svg>
      </section>

      <p className="stair-calculator-note">
        Changing rise or tread keeps the slope at 630 mm. Changing floor height selects the closest whole number of steps; changing step count keeps the floor height and tread unchanged.
      </p>
    </main>
  );
}

export default StairCalculator;
