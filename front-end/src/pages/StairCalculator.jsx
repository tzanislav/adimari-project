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

      <p className="stair-calculator-note">
        Changing rise or tread keeps the slope at 630 mm. Changing floor height selects the closest whole number of steps; changing step count keeps the floor height and tread unchanged.
      </p>
    </main>
  );
}

export default StairCalculator;
