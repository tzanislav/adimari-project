import { useRef, useState } from 'react';
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

const roundToMillimetre = (value) => Math.round(value);
const metresFromMillimetres = (value) => roundToMillimetre(value) / 1000;
const formatMetres = (value) => metresFromMillimetres(value).toFixed(3);
const findIdealStepCountForTread = (floorHeight, tread, currentSteps) => {
  const idealRise = (IDEAL_SLOPE - tread) / 2;
  if (idealRise <= 0) return currentSteps;

  const floorHeightInMillimetres = floorHeight * 1000;
  const estimatedSteps = Math.max(1, roundToMillimetre(floorHeightInMillimetres / idealRise));
  let bestSteps = estimatedSteps;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let candidate = Math.max(1, estimatedSteps - 3); candidate <= estimatedSteps + 3; candidate += 1) {
    const candidateRise = roundToMillimetre(floorHeightInMillimetres / candidate);
    const slopeDifference = Math.abs((2 * candidateRise) + tread - IDEAL_SLOPE);
    const heightResidual = Math.abs(floorHeightInMillimetres - (candidateRise * candidate));
    const score = (slopeDifference * 1000) + heightResidual + (Math.abs(candidate - currentSteps) * 0.001);

    if (score < bestScore) {
      bestSteps = candidate;
      bestScore = score;
    }
  }

  return bestSteps;
};

function StairCalculator() {
  const [rise, setRise] = useState(160);
  const [tread, setTread] = useState(310);
  const [steps, setSteps] = useState(16);
  const [floorHeight, setFloorHeight] = useState(2.56);
  const [landingFlooring, setLandingFlooring] = useState(50);
  const [stepFlooring, setStepFlooring] = useState(20);
  const [schematicZoom, setSchematicZoom] = useState(1);
  const [isRiseUnlocked, setIsRiseUnlocked] = useState(false);
  const [fieldValues, setFieldValues] = useState({
    rise: '160',
    tread: '310',
    steps: '16',
    floorHeight: '2.56',
    landingFlooring: '50',
    stepFlooring: '20',
  });
  const [lastEditedField, setLastEditedField] = useState('steps');
  const schematicRef = useRef(null);

  const slope = (2 * rise) + tread;
  const slopeStatus = slope >= MIN_IDEAL_SLOPE && slope <= MAX_IDEAL_SLOPE;
  const totalRise = rise * steps;
  const floorHeightResidual = roundToMillimetre((floorHeight * 1000) - totalRise);
  const treadCount = Math.max(steps - 1, 0);
  const totalRun = tread * treadCount;
  const drawing = { width: 1000, height: 560, left: 92, right: 60, top: 48, bottom: 188 };
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
  const firstConcreteRiserHeight = roundToMillimetre(rise + landingFlooring - stepFlooring);
  const lastConcreteRiserHeight = roundToMillimetre(rise - landingFlooring + stepFlooring);
  const firstRiserDimensionX = concreteStart.x - 18;
  const lastRiserDimensionX = upperLandingConcreteStart + 18;

  function applyCalculatorValues(nextValues) {
    setRise(nextValues.rise);
    setTread(nextValues.tread);
    setSteps(nextValues.steps);
    setFloorHeight(nextValues.floorHeight);
    setLandingFlooring(nextValues.landingFlooring);
    setStepFlooring(nextValues.stepFlooring);
    setFieldValues({
      rise: String(nextValues.rise),
      tread: String(nextValues.tread),
      steps: String(nextValues.steps),
      floorHeight: String(nextValues.floorHeight),
      landingFlooring: String(nextValues.landingFlooring),
      stepFlooring: String(nextValues.stepFlooring),
    });
  }

  function resetFieldValues() {
    applyCalculatorValues({ rise, tread, steps, floorHeight, landingFlooring, stepFlooring });
  }

  function handleFieldInput(field, event) {
    setFieldValues((currentValues) => ({ ...currentValues, [field]: event.target.value }));
    setLastEditedField(field);
  }

  function commitField(field) {
    const inputValue = Number(fieldValues[field]);
    const currentValues = { rise, tread, steps, floorHeight, landingFlooring, stepFlooring };
    const nextValues = { ...currentValues };

    if (!Number.isFinite(inputValue)) {
      resetFieldValues();
      return;
    }

    if (field === 'rise') {
      if (inputValue <= 0) return resetFieldValues();
      nextValues.rise = roundToMillimetre(inputValue);
      if (!isRiseUnlocked) nextValues.tread = roundToMillimetre(IDEAL_SLOPE - (2 * nextValues.rise));
    }

    if (field === 'tread') {
      if (inputValue <= 0) return resetFieldValues();
      nextValues.tread = roundToMillimetre(inputValue);
      if (!isRiseUnlocked) {
        nextValues.steps = findIdealStepCountForTread(floorHeight, nextValues.tread, steps);
        nextValues.rise = roundToMillimetre((floorHeight * 1000) / nextValues.steps);
      }
    }

    if (field === 'steps') {
      if (inputValue < 1) return resetFieldValues();
      nextValues.steps = Math.max(1, roundToMillimetre(inputValue));
      if (!isRiseUnlocked) {
        nextValues.rise = roundToMillimetre((floorHeight * 1000) / nextValues.steps);
        nextValues.tread = roundToMillimetre(IDEAL_SLOPE - (2 * nextValues.rise));
      }
    }

    if (field === 'floorHeight') {
      if (inputValue <= 0) return resetFieldValues();
      nextValues.floorHeight = inputValue;
      nextValues.rise = roundToMillimetre((inputValue * 1000) / steps);
      nextValues.tread = roundToMillimetre(IDEAL_SLOPE - (2 * nextValues.rise));
    }

    if (field === 'landingFlooring' || field === 'stepFlooring') {
      if (inputValue < 0) return resetFieldValues();
      nextValues[field] = roundToMillimetre(inputValue);
    }

    applyCalculatorValues(nextValues);
  }

  function handleFieldKeyDown(field, event) {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    commitField(field);
    event.currentTarget.blur();
  }

  function changeSchematicZoom(amount) {
    setSchematicZoom((currentZoom) => Math.min(MAX_SCHEMATIC_ZOOM, Math.max(MIN_SCHEMATIC_ZOOM, currentZoom + amount)));
  }

  function handleRiseUnlockChange(event) {
    const nextIsRiseUnlocked = event.target.checked;
    setIsRiseUnlocked(nextIsRiseUnlocked);

    if (!nextIsRiseUnlocked) {
      const nextRise = roundToMillimetre((floorHeight * 1000) / steps);
      applyCalculatorValues({
        rise: nextRise,
        tread: roundToMillimetre(IDEAL_SLOPE - (2 * nextRise)),
        steps,
        floorHeight,
        landingFlooring,
        stepFlooring,
      });
    }
  }

  function saveSchematicAsPng() {
    const svg = schematicRef.current;
    if (!svg) return;

    const { width, height } = svg.viewBox.baseVal;
    const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;

      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;

        const pngUrl = URL.createObjectURL(pngBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = pngUrl;
        downloadLink.download = 'stair-schematic.png';
        downloadLink.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };

    image.onerror = () => URL.revokeObjectURL(svgUrl);
    image.src = svgUrl;
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
            <span className="stair-calculator-field-label">
              Step height (rise)
              <span className="stair-calculator-rise-toggle">
                <input type="checkbox" checked={isRiseUnlocked} onChange={handleRiseUnlockChange} />
                Enter manually
              </span>
            </span>
            <span className="stair-calculator-input">
              <input type="number" min="1" step="0.1" value={fieldValues.rise} disabled={!isRiseUnlocked} onChange={(event) => handleFieldInput('rise', event)} onBlur={() => commitField('rise')} onKeyDown={(event) => handleFieldKeyDown('rise', event)} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Step depth (tread)
            <span className="stair-calculator-input">
              <input type="number" min="1" step="0.1" value={fieldValues.tread} onChange={(event) => handleFieldInput('tread', event)} onBlur={() => commitField('tread')} onKeyDown={(event) => handleFieldKeyDown('tread', event)} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Total number of steps
            <span className="stair-calculator-input">
              <input type="number" min="1" step="1" value={fieldValues.steps} onChange={(event) => handleFieldInput('steps', event)} onBlur={() => commitField('steps')} onKeyDown={(event) => handleFieldKeyDown('steps', event)} />
              <span>steps</span>
            </span>
          </label>
          <label>
            Floor-to-floor height
            <span className="stair-calculator-input">
              <input type="number" min="0.01" step="0.001" value={fieldValues.floorHeight} disabled={isRiseUnlocked} onChange={(event) => handleFieldInput('floorHeight', event)} onBlur={() => commitField('floorHeight')} onKeyDown={(event) => handleFieldKeyDown('floorHeight', event)} />
              <span>m</span>
            </span>
          </label>
          <label>
            Landing flooring thickness
            <span className="stair-calculator-input">
              <input type="number" min="0" step="0.1" value={fieldValues.landingFlooring} onChange={(event) => handleFieldInput('landingFlooring', event)} onBlur={() => commitField('landingFlooring')} onKeyDown={(event) => handleFieldKeyDown('landingFlooring', event)} />
              <span>mm</span>
            </span>
          </label>
          <label>
            Step flooring thickness
            <span className="stair-calculator-input">
              <input type="number" min="0" step="0.1" value={fieldValues.stepFlooring} onChange={(event) => handleFieldInput('stepFlooring', event)} onBlur={() => commitField('stepFlooring')} onKeyDown={(event) => handleFieldKeyDown('stepFlooring', event)} />
              <span>mm</span>
            </span>
          </label>
          <div className="stair-calculator-residual">
            <span>Floor-height residual</span>
            <strong>{floorHeightResidual > 0 ? '+' : ''}{floorHeightResidual} mm</strong>
            <small>Floor-to-floor height − calculated total rise</small>
          </div>
          <div className="stair-calculator-actions">
            <button type="button" onClick={() => commitField(lastEditedField)}>Recalculate</button>
          </div>
        </div>

        <div className="stair-calculator-result" aria-live="polite">
          <p>Calculated slope</p>
          <strong>{roundToMillimetre(slope)} mm</strong>
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
          <p>{steps} steps · {roundToMillimetre(rise)} mm rise · {roundToMillimetre(tread)} mm tread</p>
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
            ref={schematicRef}
            xmlns="http://www.w3.org/2000/svg"
            className="stair-schematic-drawing"
            style={{ width: `${schematicZoom * 100}%` }}
            viewBox={`0 0 ${drawing.width} ${drawing.height}`}
            role="img"
            aria-label={`Side view of ${steps} stairs with a ${roundToMillimetre(rise)} millimetre rise and ${roundToMillimetre(tread)} millimetre tread`}
          >
          <defs>
            <marker id="dimension-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <style>{`
            text { font-family: Arial, sans-serif; }
            .stair-schematic-steps { fill: none; stroke: #222; stroke-linecap: square; stroke-linejoin: miter; stroke-width: 3; vector-effect: non-scaling-stroke; }
            .stair-schematic-concrete-fill { fill: #e7e7e7; }
            .stair-schematic-flooring-fill { fill: #decdb9; }
            .stair-schematic-concrete-outline { fill: none; stroke: #8b6b4f; stroke-linecap: square; stroke-linejoin: miter; stroke-width: 3; vector-effect: non-scaling-stroke; }
            .stair-schematic-floor { stroke: #777; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
            .stair-schematic-landing { stroke: #222; stroke-width: 3; vector-effect: non-scaling-stroke; }
            .stair-schematic-extension { stroke: #aaa; stroke-dasharray: 4 4; stroke-width: 1; vector-effect: non-scaling-stroke; }
            .stair-schematic-dimension { stroke: #555; stroke-width: 1.2; vector-effect: non-scaling-stroke; }
            .stair-schematic-concrete-measurement { stroke: #8b6b4f; stroke-width: 1.2; vector-effect: non-scaling-stroke; }
            .stair-schematic-label { fill: #555; font-size: 18px; }
            .stair-schematic-concrete-measurement-label { fill: #8b6b4f; font-size: 15px; }
            .stair-schematic-export-details { fill: #555; font-size: 14px; }
            .stair-schematic-export-divider { stroke: #d0d0d0; stroke-width: 1; vector-effect: non-scaling-stroke; }
            marker path { fill: #555; }
          `}</style>
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
                {formatMetres(totalRun)} m total run
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
            {formatMetres(totalRise)} m total rise
          </text>
          <line className="stair-schematic-export-divider" x1="46" y1={drawing.height - 64} x2={drawing.width - 46} y2={drawing.height - 64} />
          <text className="stair-schematic-export-details" x="46" y={drawing.height - 38}>
            Rise: {rise} mm   Tread: {tread} mm   Steps: {steps}   Floor-to-floor: {floorHeight} m
          </text>
          <text className="stair-schematic-export-details" x="46" y={drawing.height - 16}>
            Landing flooring: {landingFlooring} mm   Step flooring: {stepFlooring} mm   Manual rise: {isRiseUnlocked ? 'Yes' : 'No'}
          </text>
          </svg>
        </div>
        <div className="stair-schematic-download">
          <button type="button" onClick={saveSchematicAsPng}>Save as PNG</button>
        </div>
      </section>

      <p className="stair-calculator-note">
        Floor-to-floor height and step count calculate the rise, then the tread is calculated from the 630 mm ideal slope. Editing tread searches nearby whole step counts for the closest ideal slope; enable “Enter manually” to set the rise while keeping the floor-to-floor height fixed.
      </p>
    </main>
  );
}

export default StairCalculator;
