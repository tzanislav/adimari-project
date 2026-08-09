import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../CSS/StairCalculator.css';

const IDEAL_SLOPE = 630;
const MIN_IDEAL_SLOPE = 620;
const MAX_IDEAL_SLOPE = 640;
const CONCRETE_LANDING_THICKNESS = 180;
const CONCRETE_FLIGHT_THICKNESS = 160;
const MIN_SCHEMATIC_ZOOM = 0.75;
const MAX_SCHEMATIC_ZOOM = 2.5;
const SCHEMATIC_ZOOM_STEP = 0.25;

const roundToTenth = (value) => Math.round(value * 10) / 10;

function StairCalculator() {
  const [rise, setRise] = useState(160);
  const [tread, setTread] = useState(310);
  const [steps, setSteps] = useState(16);
  const [floorHeight, setFloorHeight] = useState(2.56);
  const [landingFlooring, setLandingFlooring] = useState(50);
  const [stepFlooring, setStepFlooring] = useState(20);
  const [schematicZoom, setSchematicZoom] = useState(1);

  const slope = (2 * rise) + tread;
  const slopeStatus = slope >= MIN_IDEAL_SLOPE && slope <= MAX_IDEAL_SLOPE;
  const totalRise = rise * steps;
  const treadCount = Math.max(steps - 1, 0);
  const totalRun = tread * treadCount;
  const drawing = { width: 1000, height: 500, left: 92, right: 60, top: 48, bottom: 128 };
  const drawingScale = Math.min(
    (drawing.width - drawing.left - drawing.right - 120) / Math.max(totalRun, 1),
    (drawing.height - drawing.top - drawing.bottom) / totalRise,
  );
  const stairStart = { x: drawing.left, y: drawing.height - drawing.bottom };
  const stairCommands = Array.from({ length: steps }, (_, index) => {
    const y = stairStart.y - ((index + 1) * rise * drawingScale);
    const x = stairStart.x + (Math.min(index, treadCount) * tread * drawingScale);
    return index < treadCount ? `V ${y} H ${x + (tread * drawingScale)}` : `V ${y}`;
  }).join(' ');
  const stairEnd = {
    x: stairStart.x + (totalRun * drawingScale),
    y: stairStart.y - (totalRise * drawingScale),
  };
  const riseDimensionX = drawing.width - 32;
  const riseDimensionLabelX = riseDimensionX - 18;
  const upperLandingEnd = stairEnd.x + (2 * tread * drawingScale);
  const stepFlooringOffset = stepFlooring * drawingScale;
  const upperLandingConcreteStart = stairEnd.x + stepFlooringOffset;
  const concreteStart = { x: stairStart.x + stepFlooringOffset, y: stairStart.y + (landingFlooring * drawingScale) };
  const concreteStairCommands = Array.from({ length: steps }, (_, index) => {
    const x = stairStart.x + (Math.min(index, treadCount) * tread * drawingScale) + stepFlooringOffset;
    const finishedY = stairStart.y - ((index + 1) * rise * drawingScale);
    const finishThickness = index === steps - 1 ? landingFlooring : stepFlooring;
    const concreteY = finishedY + (finishThickness * drawingScale);
    return index < treadCount ? `V ${concreteY} H ${x + (tread * drawingScale)}` : `V ${concreteY}`;
  }).join(' ');
  const finishedStairPoints = [stairStart];
  const concreteStairPoints = [concreteStart];
  Array.from({ length: steps }, (_, index) => {
    const x = stairStart.x + (Math.min(index, treadCount) * tread * drawingScale);
    const concreteX = x + stepFlooringOffset;
    const finishedY = stairStart.y - ((index + 1) * rise * drawingScale);
    const finishThickness = index === steps - 1 ? landingFlooring : stepFlooring;
    const concreteY = finishedY + (finishThickness * drawingScale);

    finishedStairPoints.push({ x, y: finishedY });
    concreteStairPoints.push({ x: concreteX, y: concreteY });

    if (index < treadCount) {
      const nextX = x + (tread * drawingScale);
      finishedStairPoints.push({ x: nextX, y: finishedY });
      concreteStairPoints.push({ x: nextX + stepFlooringOffset, y: concreteY });
    }
  });
  const flooringFlightPoints = [...finishedStairPoints, ...concreteStairPoints.reverse()]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  const upperLandingConcreteTop = stairEnd.y + (landingFlooring * drawingScale);
  const landingConcreteThickness = CONCRETE_LANDING_THICKNESS * drawingScale;
  const flightThicknessOffset = CONCRETE_FLIGHT_THICKNESS * drawingScale * Math.sqrt(1 + ((rise / tread) ** 2));
  const riserBottomEndY = stairStart.y - (treadCount * rise * drawingScale);
  const soffitStart = { x: concreteStart.x, y: stairStart.y + flightThicknessOffset };
  const soffitEnd = { x: stairEnd.x + stepFlooringOffset, y: riserBottomEndY + flightThicknessOffset };
  const totalRunDimensionY = concreteStart.y + landingConcreteThickness + 28;
  const totalRunLabelY = totalRunDimensionY + 28;
  const firstConcreteStepTopY = stairStart.y - (rise * drawingScale) + stepFlooringOffset;
  const lastConcreteStepTopY = stairStart.y - (treadCount * rise * drawingScale) + stepFlooringOffset;
  const firstConcreteRiserHeight = roundToTenth(rise + landingFlooring - stepFlooring);
  const lastConcreteRiserHeight = roundToTenth(rise - landingFlooring + stepFlooring);
  const firstRiserDimensionX = concreteStart.x - 18;
  const lastRiserDimensionX = upperLandingConcreteStart + 18;

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

  function handleLandingFlooringChange(event) {
    const nextThickness = Number(event.target.value);
    if (!Number.isFinite(nextThickness) || nextThickness < 0) return;

    setLandingFlooring(nextThickness);
  }

  function handleStepFlooringChange(event) {
    const nextThickness = Number(event.target.value);
    if (!Number.isFinite(nextThickness) || nextThickness < 0) return;

    setStepFlooring(nextThickness);
  }

  function changeSchematicZoom(amount) {
    setSchematicZoom((currentZoom) => Math.min(MAX_SCHEMATIC_ZOOM, Math.max(MIN_SCHEMATIC_ZOOM, currentZoom + amount)));
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
          <label>
            Landing flooring thickness
            <span className="stair-calculator-input">
              <input type="number" min="0" step="0.1" value={landingFlooring} onChange={handleLandingFlooringChange} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Step flooring thickness
            <span className="stair-calculator-input">
              <input type="number" min="0" step="0.1" value={stepFlooring} onChange={handleStepFlooringChange} />
              <span>mm</span>
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
        <div className="stair-schematic-legend" aria-label="Schematic key">
          <span><i className="stair-schematic-key-finish" aria-hidden="true" />Finished flooring</span>
          <span><i className="stair-schematic-key-concrete" aria-hidden="true" />Concrete structure</span>
        </div>
        <div className="stair-schematic-controls" aria-label="Schematic zoom controls">
          <button type="button" onClick={() => changeSchematicZoom(-SCHEMATIC_ZOOM_STEP)} disabled={schematicZoom <= MIN_SCHEMATIC_ZOOM} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setSchematicZoom(1)} disabled={schematicZoom === 1}>Reset zoom</button>
          <output aria-live="polite">{Math.round(schematicZoom * 100)}%</output>
          <button type="button" onClick={() => changeSchematicZoom(SCHEMATIC_ZOOM_STEP)} disabled={schematicZoom >= MAX_SCHEMATIC_ZOOM} aria-label="Zoom in">+</button>
        </div>
        <div className="stair-schematic-viewport">
          <svg
            className="stair-schematic-drawing"
            style={{ width: `${schematicZoom * 100}%` }}
            viewBox={`0 0 ${drawing.width} ${drawing.height}`}
            role="img"
            aria-label={`Side view of ${steps} stairs with a ${roundToTenth(rise)} millimetre rise and ${roundToTenth(tread)} millimetre tread`}
          >
          <defs>
            <marker id="dimension-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <rect
            className="stair-schematic-concrete-fill"
            x="46"
            y={concreteStart.y}
            width={upperLandingEnd - 46}
            height={landingConcreteThickness}
          />
          <rect
            className="stair-schematic-concrete-fill"
            x={upperLandingConcreteStart}
            y={upperLandingConcreteTop}
            width={upperLandingEnd - upperLandingConcreteStart}
            height={landingConcreteThickness}
          />
          <path
            className="stair-schematic-concrete-fill"
            d={`M ${concreteStart.x} ${concreteStart.y} ${concreteStairCommands} L ${soffitEnd.x} ${soffitEnd.y} L ${soffitStart.x} ${soffitStart.y} Z`}
          />
          <rect
            className="stair-schematic-flooring-fill"
            x="46"
            y={stairStart.y}
            width={stairStart.x - 46}
            height={landingFlooring * drawingScale}
          />
          <polygon className="stair-schematic-flooring-fill" points={flooringFlightPoints} />
          <rect
            className="stair-schematic-flooring-fill"
            x={stairEnd.x}
            y={stairEnd.y}
            width={upperLandingEnd - stairEnd.x}
            height={landingFlooring * drawingScale}
          />
          <path className="stair-schematic-steps" d={`M ${stairStart.x} ${stairStart.y} ${stairCommands}`} />
          <rect
            className="stair-schematic-concrete-outline"
            x="46"
            y={concreteStart.y}
            width={upperLandingEnd - 46}
            height={landingConcreteThickness}
          />
          <rect
            className="stair-schematic-concrete-outline"
            x={upperLandingConcreteStart}
            y={upperLandingConcreteTop}
            width={upperLandingEnd - upperLandingConcreteStart}
            height={landingConcreteThickness}
          />
          <path
            className="stair-schematic-concrete-outline"
            d={`M ${concreteStart.x} ${concreteStart.y} ${concreteStairCommands} L ${soffitEnd.x} ${soffitEnd.y} L ${soffitStart.x} ${soffitStart.y} Z`}
          />
          <line className="stair-schematic-extension" x1={firstRiserDimensionX + 5} y1={concreteStart.y} x2={concreteStart.x - 3} y2={concreteStart.y} />
          <line className="stair-schematic-extension" x1={firstRiserDimensionX + 5} y1={firstConcreteStepTopY} x2={concreteStart.x - 3} y2={firstConcreteStepTopY} />
          <line
            className="stair-schematic-concrete-measurement"
            x1={firstRiserDimensionX}
            y1={concreteStart.y - 4}
            x2={firstRiserDimensionX}
            y2={firstConcreteStepTopY + 4}
            markerStart="url(#dimension-arrow)"
            markerEnd="url(#dimension-arrow)"
          />
          <text className="stair-schematic-concrete-measurement-label" x={firstRiserDimensionX} y={firstConcreteStepTopY - 10} textAnchor="middle">
            {firstConcreteRiserHeight} mm
          </text>
          <line className="stair-schematic-extension" x1={upperLandingConcreteStart + 3} y1={lastConcreteStepTopY} x2={lastRiserDimensionX - 5} y2={lastConcreteStepTopY} />
          <line className="stair-schematic-extension" x1={upperLandingConcreteStart + 3} y1={upperLandingConcreteTop} x2={lastRiserDimensionX - 5} y2={upperLandingConcreteTop} />
          <line
            className="stair-schematic-concrete-measurement"
            x1={lastRiserDimensionX}
            y1={lastConcreteStepTopY - 4}
            x2={lastRiserDimensionX}
            y2={upperLandingConcreteTop + 4}
            markerStart="url(#dimension-arrow)"
            markerEnd="url(#dimension-arrow)"
          />
          <text className="stair-schematic-concrete-measurement-label" x={lastRiserDimensionX} y={upperLandingConcreteTop - 10 - (landingFlooring * drawingScale)} textAnchor="middle">
            {lastConcreteRiserHeight} mm
          </text>
          <line className="stair-schematic-floor" x1="46" y1={stairStart.y} x2={stairEnd.x + 28} y2={stairStart.y} />
          <line className="stair-schematic-landing" x1={stairEnd.x} y1={stairEnd.y} x2={upperLandingEnd} y2={stairEnd.y} />
          {totalRun > 0 && (
            <>
              <line className="stair-schematic-extension" x1={stairStart.x} y1={stairStart.y + 8} x2={stairStart.x} y2={totalRunDimensionY - 12} />
              <line className="stair-schematic-extension" x1={stairEnd.x} y1={stairStart.y + 8} x2={stairEnd.x} y2={totalRunDimensionY - 12} />
              <line
                className="stair-schematic-dimension"
                x1={stairStart.x + 7}
                y1={totalRunDimensionY}
                x2={stairEnd.x - 7}
                y2={totalRunDimensionY}
                markerStart="url(#dimension-arrow)"
                markerEnd="url(#dimension-arrow)"
              />
              <text className="stair-schematic-label" x={(stairStart.x + stairEnd.x) / 2} y={totalRunLabelY} textAnchor="middle">
                {roundToTenth(totalRun / 1000)} m total run
              </text>
            </>
          )}
          <line className="stair-schematic-extension" x1={stairStart.x - 8} y1={stairStart.y} x2={riseDimensionX + 18} y2={stairStart.y} />
          <line className="stair-schematic-extension" x1={stairEnd.x + 8} y1={stairEnd.y} x2={riseDimensionX + 18} y2={stairEnd.y} />
          <line
            className="stair-schematic-dimension"
            x1={riseDimensionX}
            y1={stairStart.y - 7}
            x2={riseDimensionX}
            y2={stairEnd.y + 7}
            markerStart="url(#dimension-arrow)"
            markerEnd="url(#dimension-arrow)"
          />
          <text className="stair-schematic-label" x={riseDimensionLabelX} y={(stairStart.y + stairEnd.y) / 2} textAnchor="middle" transform={`rotate(-90 ${riseDimensionLabelX} ${(stairStart.y + stairEnd.y) / 2})`}>
            {roundToTenth(totalRise / 1000)} m total rise
          </text>
          </svg>
        </div>
      </section>

      <p className="stair-calculator-note">
        Changing rise or tread keeps the slope at 630 mm. Changing floor height selects the closest whole number of steps; changing step count keeps the floor height and tread unchanged.
      </p>
    </main>
  );
}

export default StairCalculator;
