/* eslint-disable react/prop-types */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/Billing.css';

const serviceColors = ['#ad563b', '#64748b', '#c48f2d', '#6d8f7e', '#8b6f9e', '#537b98'];

const formatCurrency = (amount, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(Number(amount) || 0);

const formatDate = (dateString) => {
  if (!dateString) return '\u2014';

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dateString}T00:00:00Z`));
};

const formatMonth = (dateString) => new Intl.DateTimeFormat('en-GB', {
  month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${dateString}T00:00:00Z`));

const percentageChange = (currentValue, previousValue) => {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
};

const describeChange = (change, comparison) => {
  if (change === null) return `${comparison} has no comparable prior cost.`;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged';
  return `${Math.abs(change).toFixed(0)}% ${direction} from ${comparison}.`;
};

const getChartData = (monthlyBreakdown = []) => {
  const totalsByService = new Map();
  monthlyBreakdown.forEach((month) => month.services.forEach((service) => {
    totalsByService.set(service.name, (totalsByService.get(service.name) || 0) + service.amount);
  }));

  const prominentServices = Array.from(totalsByService.entries())
    .sort(([, leftAmount], [, rightAmount]) => rightAmount - leftAmount)
    .slice(0, 5)
    .map(([name]) => name);
  const hasRemainingServices = totalsByService.size > prominentServices.length;
  const serviceNames = hasRemainingServices ? [...prominentServices, 'Other'] : prominentServices;
  const months = monthlyBreakdown.map((month) => {
    const amounts = new Map(month.services.map((service) => [service.name, service.amount]));
    const knownServiceTotal = prominentServices.reduce((total, name) => total + (amounts.get(name) || 0), 0);

    return {
      ...month,
      services: serviceNames.map((name) => ({
        name,
        amount: name === 'Other' ? Math.max(0, month.total - knownServiceTotal) : (amounts.get(name) || 0),
      })).filter((service) => service.amount > 0),
    };
  });

  return { months, serviceNames };
};

const getBreakdownRows = (monthlyBreakdown = []) => {
  const rowsByService = new Map();
  monthlyBreakdown.forEach((month) => month.services.forEach((service) => {
    const row = rowsByService.get(service.name) || { name: service.name, total: 0, amounts: new Map() };
    row.total += service.amount;
    row.amounts.set(month.startDate, service.amount);
    rowsByService.set(service.name, row);
  }));

  return Array.from(rowsByService.values()).sort((left, right) => right.total - left.total);
};

function Trend({ change, comparison }) {
  const isIncrease = change !== null && change > 0;
  const isDecrease = change !== null && change < 0;
  const symbol = isIncrease ? '\u2197' : isDecrease ? '\u2198' : '\u2014';

  return (
    <p className={`billing-trend${isIncrease ? ' is-increase' : isDecrease ? ' is-decrease' : ''}`}>
      <span aria-hidden="true">{symbol}</span>
      {describeChange(change, comparison)}
    </p>
  );
}

function MetricCard({ label, value, children }) {
  return (
    <article className="billing-metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      {children}
    </article>
  );
}

function CostBreakdown({ monthlyBreakdown, currency, groupingLabel }) {
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const breakdownId = useId();
  const tableId = useId();
  const { months, serviceNames } = useMemo(() => getChartData(monthlyBreakdown), [monthlyBreakdown]);
  const breakdownRows = useMemo(() => getBreakdownRows(monthlyBreakdown), [monthlyBreakdown]);
  const highestMonthTotal = Math.max(...months.map((month) => month.total), 0);
  const totalCost = months.reduce((total, month) => total + month.total, 0);
  const averageMonthlyCost = months.length ? totalCost / months.length : 0;

  if (months.length === 0 || highestMonthTotal <= 0) {
    return <p className="billing-empty-breakdown">No {groupingLabel}-level costs were returned for this period.</p>;
  }

  return (
    <>
      <button
        type="button"
        className="billing-breakdown-toggle"
        aria-expanded={isBreakdownOpen}
        aria-controls={breakdownId}
        onClick={() => setIsBreakdownOpen((isOpen) => !isOpen)}
      >
        <span>Cost overview and graph</span>
        <span className="billing-table-toggle-action">
          {isBreakdownOpen ? 'Hide analysis' : 'Show analysis'}
          <span aria-hidden="true">{isBreakdownOpen ? '\u2212' : '+'}</span>
        </span>
      </button>
      {isBreakdownOpen && (
        <div id={breakdownId}>
          <div className="billing-overview-grid">
            <div><span>Total cost</span><strong>{formatCurrency(totalCost, currency)}</strong></div>
            <div><span>Average monthly cost</span><strong>{formatCurrency(averageMonthlyCost, currency)}</strong></div>
            <div><span>{groupingLabel} count</span><strong>{breakdownRows.length}</strong></div>
          </div>
          <div className="billing-chart" role="img" aria-label={`Monthly costs grouped by ${groupingLabel}`}>
            <div className="billing-chart-axis">
              <span>{formatCurrency(highestMonthTotal, currency)}</span>
              <span>{formatCurrency(highestMonthTotal / 2, currency)}</span>
              <span>$0</span>
            </div>
            <div className="billing-chart-bars">
              {months.map((month) => (
                <div className="billing-chart-month" key={month.startDate}>
                  <div
                    className="billing-chart-stack"
                    style={{ '--stack-height': `${Math.max(2, (month.total / highestMonthTotal) * 100)}%` }}
                    title={`${formatMonth(month.startDate)}: ${formatCurrency(month.total, currency)}`}
                  >
                    {month.services.map((service) => {
                      const colorIndex = serviceNames.indexOf(service.name) % serviceColors.length;
                      return (
                        <span
                          className="billing-chart-segment"
                          key={service.name}
                          style={{
                            '--segment-color': serviceColors[colorIndex],
                            '--segment-share': `${(service.amount / month.total) * 100}%`,
                          }}
                          title={`${service.name}: ${formatCurrency(service.amount, currency)}`}
                        />
                      );
                    })}
                  </div>
                  <span className="billing-chart-month-label">{formatMonth(month.startDate)}</span>
                </div>
              ))}
            </div>
          </div>
          <ul className="billing-legend" aria-label={`${groupingLabel} legend`}>
            {serviceNames.map((name, index) => (
              <li key={name}><span style={{ backgroundColor: serviceColors[index % serviceColors.length] }} />{name}</li>
            ))}
          </ul>
          <div className="billing-table-disclosure">
            <button
              type="button"
              className="billing-table-toggle"
              aria-expanded={isTableOpen}
              aria-controls={tableId}
              onClick={() => setIsTableOpen((isOpen) => !isOpen)}
            >
              <span>Detailed cost breakdown</span>
              <span className="billing-table-toggle-action">
                {isTableOpen ? 'Hide table' : `Show ${breakdownRows.length} ${groupingLabel} rows`}
                <span aria-hidden="true">{isTableOpen ? '\u2212' : '+'}</span>
              </span>
            </button>
            {isTableOpen && (
              <div id={tableId} className="billing-table-wrap">
                <table className="billing-breakdown-table">
                  <caption>Cost and usage breakdown by {groupingLabel}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{groupingLabel}</th>
                      <th scope="col">Total</th>
                      {months.map((month) => <th scope="col" key={month.startDate}>{formatMonth(month.startDate)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="billing-total-row">
                      <th scope="row">Total costs</th>
                      <td>{formatCurrency(totalCost, currency)}</td>
                      {months.map((month) => <td key={month.startDate}>{formatCurrency(month.total, currency)}</td>)}
                    </tr>
                    {breakdownRows.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">{row.name}</th>
                        <td>{formatCurrency(row.total, currency)}</td>
                        {months.map((month) => {
                          const amount = row.amounts.get(month.startDate);
                          return <td key={month.startDate}>{amount === undefined ? '\u2014' : formatCurrency(amount, currency)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CostSection({
  id, source, title, loading, error, summary, groupingLabel, hasForecast = false,
}) {
  const monthToDateChange = summary ? percentageChange(summary.monthToDate, summary.previousMonthSamePeriod) : null;
  const forecastChange = summary && hasForecast
    ? percentageChange(summary.forecastedMonthTotal, summary.previousMonthTotal)
    : null;

  return (
    <section className="billing-section" aria-labelledby={id}>
      <div className="billing-section-heading">
        <div>
          <p className="billing-section-kicker">{source}</p>
          <h2 id={id}>{title}</h2>
        </div>
        {summary && (
          <p className="billing-updated-at">
            Updated {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.generatedAt))}
          </p>
        )}
      </div>

      {loading && !summary && <div className="billing-status">Loading {title.toLowerCase()}...</div>}
      {!loading && error && (
        <div className="billing-status is-error" role="alert">
          <strong>{title} are unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="billing-section-content">
          <div className="billing-cost-summary">
            <MetricCard label="Month-to-date cost" value={formatCurrency(summary.monthToDate, summary.currency)}>
              <Trend change={monthToDateChange} comparison="the same point last month" />
            </MetricCard>
            <MetricCard label="Same period last month" value={formatCurrency(summary.previousMonthSamePeriod, summary.currency)}>
              <p className="billing-metric-detail">{formatDate(summary.period.startDate)} - {formatDate(summary.period.endDate)}</p>
            </MetricCard>
            {hasForecast ? (
              <MetricCard
                label="Forecasted cost this month"
                value={summary.forecastedMonthTotal === null ? 'Not available' : formatCurrency(summary.forecastedMonthTotal, summary.currency)}
              >
                {summary.forecastedMonthTotal !== null && <Trend change={forecastChange} comparison="last month's total" />}
              </MetricCard>
            ) : (
              <MetricCard label="Cost grouping" value="Line items">
                <p className="billing-metric-detail">Organization-wide API costs</p>
              </MetricCard>
            )}
            <MetricCard label="Last month's total" value={formatCurrency(summary.previousMonthTotal, summary.currency)}>
              <p className="billing-metric-detail">Final reported cost</p>
            </MetricCard>
          </div>

          <div className="billing-breakdown-card">
            <div className="billing-breakdown-heading">
              <div>
                <h3>Cost breakdown</h3>
                <p>Last six months, grouped by {groupingLabel}.</p>
              </div>
              <span className="billing-cost-type">Reported cost</span>
            </div>
            <CostBreakdown monthlyBreakdown={summary.monthlyBreakdown} currency={summary.currency} groupingLabel={groupingLabel} />
          </div>
        </div>
      )}
    </section>
  );
}

function MongoDbAtlasCostSection({ loading, error, summary }) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyId = useId();
  const monthlyHistory = summary?.monthlyHistory || [];
  const highestMonthlyCost = Math.max(...monthlyHistory.map((month) => month.total), 0);
  const isPendingMonthlyCost = summary?.monthlyCostPeriod?.isPending;

  return (
    <section className="billing-section" aria-labelledby="mongodb-atlas-costs-heading">
      <div className="billing-section-heading">
        <div>
          <p className="billing-section-kicker">MongoDB Atlas billing</p>
          <h2 id="mongodb-atlas-costs-heading">MongoDB Atlas costs</h2>
        </div>
        {summary && (
          <p className="billing-updated-at">
            Updated {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.generatedAt))}
          </p>
        )}
      </div>

      {loading && !summary && <div className="billing-status">Loading MongoDB Atlas costs...</div>}
      {!loading && error && (
        <div className="billing-status is-error" role="alert">
          <strong>MongoDB Atlas costs are unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="billing-section-content">
          <div className="billing-cost-summary billing-single-cost-summary">
            <MetricCard
              label={isPendingMonthlyCost ? 'Monthly cost' : 'Previous month cost'}
              value={formatCurrency(summary.currentMonthlyCost, summary.currency)}
            >
              <p className="billing-metric-detail">
                {isPendingMonthlyCost
                  ? 'Current pending invoice'
                  : summary.monthlyCostPeriod
                    ? `Final invoice for ${formatMonth(summary.monthlyCostPeriod.startDate)}`
                    : 'No invoice is available'}
              </p>
            </MetricCard>
          </div>

          <div className="billing-breakdown-card">
            <div className="billing-breakdown-heading">
              <div>
                <h3>Monthly cost history</h3>
                <p>Current pending and completed invoices for the last several months.</p>
              </div>
              <span className="billing-cost-type">Atlas invoices</span>
            </div>

            {monthlyHistory.length === 0 ? (
              <p className="billing-empty-breakdown">No MongoDB Atlas invoice history is available yet.</p>
            ) : (
              <>
                <button
                  type="button"
                  className="billing-breakdown-toggle"
                  aria-expanded={isHistoryOpen}
                  aria-controls={historyId}
                  onClick={() => setIsHistoryOpen((isOpen) => !isOpen)}
                >
                  <span>Monthly cost breakdown</span>
                  <span className="billing-table-toggle-action">
                    {isHistoryOpen ? 'Hide history' : `Show ${monthlyHistory.length} months`}
                    <span aria-hidden="true">{isHistoryOpen ? '\u2212' : '+'}</span>
                  </span>
                </button>
                {isHistoryOpen && (
                  <div id={historyId}>
                    <div className="billing-chart" role="img" aria-label="MongoDB Atlas monthly invoice costs">
                      <div className="billing-chart-axis">
                        <span>{formatCurrency(highestMonthlyCost, summary.currency)}</span>
                        <span>{formatCurrency(highestMonthlyCost / 2, summary.currency)}</span>
                        <span>{formatCurrency(0, summary.currency)}</span>
                      </div>
                      <div className="billing-chart-bars" style={{ '--month-count': monthlyHistory.length }}>
                        {monthlyHistory.map((month) => (
                          <div className="billing-chart-month" key={month.startDate}>
                            <div
                              className="billing-chart-stack"
                              style={{ '--stack-height': `${Math.max(2, highestMonthlyCost ? (month.total / highestMonthlyCost) * 100 : 2)}%` }}
                              title={`${formatMonth(month.startDate)}: ${formatCurrency(month.total, summary.currency)}`}
                            >
                              <span
                                className="billing-chart-segment"
                                style={{ '--segment-color': serviceColors[0], '--segment-share': '100%' }}
                              />
                            </div>
                            <span className="billing-chart-month-label">{formatMonth(month.startDate)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="billing-history-table-wrap">
                      <table className="billing-history-table">
                        <caption>MongoDB Atlas monthly invoice costs</caption>
                        <thead>
                          <tr><th scope="col">Month</th><th scope="col">Cost</th></tr>
                        </thead>
                        <tbody>
                          {monthlyHistory.map((month) => (
                            <tr key={month.startDate}>
                              <th scope="row">{formatMonth(month.startDate)}</th>
                              <td>{formatCurrency(month.total, summary.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Billing() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const [awsSummary, setAwsSummary] = useState(null);
  const [awsLoading, setAwsLoading] = useState(true);
  const [awsError, setAwsError] = useState('');
  const [openAiSummary, setOpenAiSummary] = useState(null);
  const [openAiLoading, setOpenAiLoading] = useState(true);
  const [openAiError, setOpenAiError] = useState('');
  const [mongoDbAtlasSummary, setMongoDbAtlasSummary] = useState(null);
  const [mongoDbAtlasLoading, setMongoDbAtlasLoading] = useState(true);
  const [mongoDbAtlasError, setMongoDbAtlasError] = useState('');

  const loadSummary = useCallback(async ({ endpoint, setSummary, setLoading, setError, fallbackError }) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchWithAuth(`${serverUrl}${endpoint}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || fallbackError);
      setSummary(payload);
    } catch (loadError) {
      console.error(`Error loading ${endpoint}:`, loadError);
      setSummary(null);
      setError(loadError.message || fallbackError);
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  const loadAwsCosts = useCallback(() => loadSummary({
    endpoint: '/api/admin/aws-costs/summary', setSummary: setAwsSummary, setLoading: setAwsLoading,
    setError: setAwsError, fallbackError: 'Unable to load AWS cost data.',
  }), [loadSummary]);
  const loadOpenAiCosts = useCallback(() => loadSummary({
    endpoint: '/api/admin/openai-costs/summary', setSummary: setOpenAiSummary, setLoading: setOpenAiLoading,
    setError: setOpenAiError, fallbackError: 'Unable to load OpenAI cost data.',
  }), [loadSummary]);
  const loadMongoDbAtlasCosts = useCallback(() => loadSummary({
    endpoint: '/api/admin/mongodb-atlas-costs/summary', setSummary: setMongoDbAtlasSummary, setLoading: setMongoDbAtlasLoading,
    setError: setMongoDbAtlasError, fallbackError: 'Unable to load MongoDB Atlas cost data.',
  }), [loadSummary]);
  const refreshCosts = useCallback(() => {
    loadAwsCosts();
    loadOpenAiCosts();
    loadMongoDbAtlasCosts();
  }, [loadAwsCosts, loadMongoDbAtlasCosts, loadOpenAiCosts]);

  useEffect(() => {
    refreshCosts();
  }, [refreshCosts]);

  const loading = awsLoading || openAiLoading || mongoDbAtlasLoading;

  return (
    <main className="billing-page">
      <header className="billing-page-header">
        <div>
          <p className="billing-eyebrow">Admin</p>
          <h1>Billing</h1>
          <p>Private cloud and API cost reporting for Adimari.</p>
        </div>
        <button type="button" className="billing-refresh-button" onClick={refreshCosts} disabled={loading}>
          <span aria-hidden="true">&#8635;</span>
          {loading ? 'Refreshing' : 'Refresh costs'}
        </button>
      </header>

      <div className="billing-sections">
        <CostSection
          id="aws-costs-heading"
          source="AWS Cost Explorer"
          title="AWS costs"
          loading={awsLoading}
          error={awsError}
          summary={awsSummary}
          groupingLabel="AWS service"
          hasForecast
        />
        <CostSection
          id="openai-costs-heading"
          source="OpenAI organization Costs API"
          title="OpenAI API costs"
          loading={openAiLoading}
          error={openAiError}
          summary={openAiSummary}
          groupingLabel="line item"
        />
        <MongoDbAtlasCostSection
          loading={mongoDbAtlasLoading}
          error={mongoDbAtlasError}
          summary={mongoDbAtlasSummary}
        />
      </div>
    </main>
  );
}

export default Billing;
