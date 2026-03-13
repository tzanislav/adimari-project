import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchWithAuth, getAuthHeaders } from '../utils/authHeaders';
import '../CSS/TeamSummary.css';

const defaultProfileImage = 'https://cdn.iconscout.com/icon/free/png-256/avatar-380-456332.png';
const dayRangeOptions = [7, 30, 60, 90];
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function formatDateCode(dateCode) {
  const timestamp = Number(dateCode);

  if (!Number.isFinite(timestamp)) {
    return 'Unknown date';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  const pad = (value) => String(value).padStart(2, '0');

  return ` ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDurationMinutes(durationMinutes) {
  const numericDuration = Number(durationMinutes);

  if (!Number.isFinite(numericDuration)) {
    return '0h 0m';
  }

  const roundedMinutes = Math.max(0, Math.round(numericDuration));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function getFolderFillPercentage(folderDurationMinutes, memberDurationMinutes) {
  const folderDuration = Number(folderDurationMinutes);
  const memberDuration = Number(memberDurationMinutes);

  if (!Number.isFinite(folderDuration) || !Number.isFinite(memberDuration) || memberDuration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (folderDuration / memberDuration) * 100));
}

function getEntryFillPercentage(entryDurationMinutes, folderDurationMinutes) {
  const entryDuration = Number(entryDurationMinutes);
  const folderDuration = Number(folderDurationMinutes);

  if (!Number.isFinite(entryDuration) || !Number.isFinite(folderDuration) || folderDuration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (entryDuration / folderDuration) * 100));
}

function getEntryTimestamp(value) {
  const timestamp = Number(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getEntryDayKey(value) {
  const timestamp = getEntryTimestamp(value);

  if (!timestamp) {
    return 'unknown-day';
  }

  const date = new Date(timestamp);

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function groupFolderEntriesByName(entries) {
  const groupedEntries = new Map();

  entries.forEach((entry) => {
    const entryName = entry.taskName || 'Unknown Task';
    const normalizedDuration = Number(entry.durationMin) || 0;
    const existingEntry = groupedEntries.get(entryName);

    if (existingEntry) {
      existingEntry.totalDurationMin += normalizedDuration;
      existingEntry.entryCount += 1;

      if (Number(entry.taskDate) > Number(existingEntry.latestTaskDate || 0)) {
        existingEntry.latestTaskDate = entry.taskDate;
      }

      return;
    }

    groupedEntries.set(entryName, {
      taskName: entryName,
      totalDurationMin: normalizedDuration,
      entryCount: 1,
      latestTaskDate: entry.taskDate,
    });
  });

  return Array.from(groupedEntries.values()).sort(
    (left, right) => getEntryTimestamp(right.latestTaskDate) - getEntryTimestamp(left.latestTaskDate)
  );
}

function getRangeForLastDays(days) {
  const normalizedDays = Number(days) || dayRangeOptions[0];
  const endDate = Date.now();
  const startDate = endDate - (normalizedDays * millisecondsPerDay);

  return {
    startDate,
    endDate,
  };
}

function formatDateInputValue(value) {
  const timestamp = getEntryTimestamp(value);

  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (datePart) => String(datePart).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getRangeForSpecificDates(startDateValue, endDateValue) {
  if (!startDateValue || !endDateValue) {
    return null;
  }

  const startDate = new Date(`${startDateValue}T00:00:00`);
  const endDate = new Date(`${endDateValue}T23:59:59.999`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  const normalizedRange = {
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
  };

  if (normalizedRange.startDate > normalizedRange.endDate) {
    return null;
  }

  return normalizedRange;
}

function getSpecificDateValidationMessage(startDateValue, endDateValue) {
  if (!startDateValue || !endDateValue) {
    return 'Select both a start and end date.';
  }

  if (!getRangeForSpecificDates(startDateValue, endDateValue)) {
    return 'Start date must be on or before the end date.';
  }

  return '';
}

function TeamSummary() {
  const { user } = useAuth();
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const initialSpecificDateRange = getRangeForLastDays(dayRangeOptions[0]);
  const [selectedDayRange, setSelectedDayRange] = useState(dayRangeOptions[0]);
  const [useSpecificDates, setUseSpecificDates] = useState(false);
  const [specificStartDate, setSpecificStartDate] = useState(() => formatDateInputValue(initialSpecificDateRange.startDate));
  const [specificEndDate, setSpecificEndDate] = useState(() => formatDateInputValue(initialSpecificDateRange.endDate));
  const [memberEntries, setMemberEntries] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [groupedFolders, setGroupedFolders] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const specificDateValidationMessage = useSpecificDates
    ? getSpecificDateValidationMessage(specificStartDate, specificEndDate)
    : '';

  const toggleFolder = (folderKey) => {
    setExpandedFolders((currentFolders) => ({
      ...currentFolders,
      [folderKey]: !currentFolders[folderKey],
    }));
  };

  const toggleGrouping = (folderKey) => {
    setGroupedFolders((currentFolders) => ({
      ...currentFolders,
      [folderKey]: !(currentFolders[folderKey] ?? true),
    }));
  };

  const handleSpecificDatesToggle = (event) => {
    const isEnabled = event.target.checked;

    if (isEnabled) {
      const currentRange = getRangeForLastDays(selectedDayRange);
      setSpecificStartDate(formatDateInputValue(currentRange.startDate));
      setSpecificEndDate(formatDateInputValue(currentRange.endDate));
    }

    setUseSpecificDates(isEnabled);
  };

  const groupEntriesByFolder = (entries) => {
    const groupedEntries = new Map();

    entries.forEach((entry) => {
      const folderKey = entry.folderId || 'no-folder';
      const normalizedDuration = Number(entry.durationMin) || 0;
      const existingGroup = groupedEntries.get(folderKey);

      if (existingGroup) {
        existingGroup.rawEntries.push(entry);
        existingGroup.totalDurationMin += normalizedDuration;
        return;
      }

      groupedEntries.set(folderKey, {
        folderId: entry.folderId,
        folderName: entry.folderName || 'No Folder',
        totalDurationMin: normalizedDuration,
        rawEntries: [entry],
      });
    });

    return Array.from(groupedEntries.values())
      .map((folderGroup) => ({
        folderId: folderGroup.folderId,
        folderName: folderGroup.folderName,
        totalDurationMin: folderGroup.totalDurationMin,
        rawEntries: [...folderGroup.rawEntries].sort(
          (left, right) => getEntryTimestamp(right.taskDate) - getEntryTimestamp(left.taskDate)
        ),
        entries: groupFolderEntriesByName(folderGroup.rawEntries),
      }))
      .sort((left, right) => left.folderName.localeCompare(right.folderName));
  };

  useEffect(() => {
    const loadEntries = async () => {
      if (!user) {
        setMemberEntries([]);
        setError('Sign in to load Team Summary data.');
        return;
      }

      let selectedRange = null;

      if (useSpecificDates) {
        selectedRange = getRangeForSpecificDates(specificStartDate, specificEndDate);

        if (!selectedRange) {
          setLoading(false);
          setError('');
          return;
        }
      } else {
        selectedRange = getRangeForLastDays(selectedDayRange);
      }

      setLoading(true);
      setError('');

      try {
        const { startDate, endDate } = selectedRange;
        const headers = await getAuthHeaders();
        const membersResponse = await fetchWithAuth(`${serverUrl}/clickup/members`, {
          headers,
        });

        if (!membersResponse.ok) {
          throw new Error('Failed to load team members.');
        }

        const membersData = await membersResponse.json();
        const members = Array.isArray(membersData.members) ? membersData.members : [];

        const entriesByMember = await Promise.all(
          members.map(async (member) => {
            const response = await fetchWithAuth(
              `${serverUrl}/clickup/time-entries/range/${member.id}?start_date=${startDate}&end_date=${endDate}`,
              {
              headers,
              }
            );

            if (!response.ok) {
              throw new Error(`Failed to load time entries for ${member.username}.`);
            }

            const data = await response.json();
            const folderGroups = groupEntriesByFolder(Array.isArray(data) ? data : []);
            const totalDurationMin = folderGroups.reduce(
              (totalDuration, folderGroup) => totalDuration + folderGroup.totalDurationMin,
              0
            );

            return {
              memberId: member.id,
              memberName: member.username,
              profilePicture: member.profilePicture || defaultProfileImage,
              totalDurationMin,
              folderGroups,
            };
          })
        );

        setMemberEntries(entriesByMember);
        setExpandedFolders({});
        setGroupedFolders({});
      } catch (loadError) {
        console.error('Error loading team summary:', loadError);
        setError('Failed to load Team Summary data.');
      } finally {
        setLoading(false);
      }
    };

    loadEntries();
  }, [selectedDayRange, serverUrl, specificEndDate, specificStartDate, useSpecificDates, user]);

  /*
  if (!user || (role !== 'admin' && role !== 'moderator')) {
    return <div>Not authorized</div>;
  }
*/
  return (
    <div className="team-summary-page">
      <div className="team-summary-header">
        <div>
          <h1>Team Summary</h1>
          <p>Team members with their ClickUp time grouped by folder and task name.</p>
        </div>
        <div className="team-summary-header-actions">
          <div className="team-summary-filter-controls">
            <label className="team-summary-range-filter" htmlFor="team-summary-range-select">
              <span>Range</span>
              <select
                id="team-summary-range-select"
                value={selectedDayRange}
                onChange={(event) => setSelectedDayRange(Number(event.target.value))}
                disabled={useSpecificDates}
              >
                {dayRangeOptions.map((days) => (
                  <option key={days} value={days}>
                    Last {days} days
                  </option>
                ))}
              </select>
            </label>
            <label className="team-summary-specific-dates-toggle" htmlFor="team-summary-specific-dates-toggle">
              <input
                id="team-summary-specific-dates-toggle"
                type="checkbox"
                checked={useSpecificDates}
                onChange={handleSpecificDatesToggle}
              />
              <span>Specific Dates</span>
            </label>
            {useSpecificDates && (
              <div className="team-summary-date-inputs">
                <label className="team-summary-date-filter" htmlFor="team-summary-start-date">
                  <span>Start</span>
                  <input
                    id="team-summary-start-date"
                    type="date"
                    value={specificStartDate}
                    max={specificEndDate || undefined}
                    onChange={(event) => setSpecificStartDate(event.target.value)}
                  />
                </label>
                <label className="team-summary-date-filter" htmlFor="team-summary-end-date">
                  <span>End</span>
                  <input
                    id="team-summary-end-date"
                    type="date"
                    value={specificEndDate}
                    min={specificStartDate || undefined}
                    onChange={(event) => setSpecificEndDate(event.target.value)}
                  />
                </label>
              </div>
            )}
            {specificDateValidationMessage && (
              <p className="team-summary-filter-message">{specificDateValidationMessage}</p>
            )}
          </div>
          <Link to="/team" className="team-summary-back-link">Back To Team Status</Link>
        </div>
      </div>
      <div className="team-summary-placeholder">
        {loading && <p>Loading...</p>}
        {!loading && error && <p>{error}</p>}
        {!loading && !error && memberEntries.length === 0 && <p>No entries found.</p>}

        {!loading && !error && memberEntries.length > 0 && (
          <div className="team-summary-group-list">
            {memberEntries.map((memberEntry) => (
              <div key={memberEntry.memberId} className="team-summary-group">
                <div className="team-summary-member-header">
                  <img
                    src={memberEntry.profilePicture}
                    alt={memberEntry.memberName}
                    className="team-summary-member-avatar"
                  />
                  <h2>{memberEntry.memberName} - {formatDurationMinutes(memberEntry.totalDurationMin)}</h2>
                </div>
                {memberEntry.folderGroups.length === 0 ? (
                  <p>No entries found.</p>
                ) : (
                  <div className="team-summary-folder-list">
                    {memberEntry.folderGroups.map((folderGroup) => (
                      (() => {
                        const folderKey = `${memberEntry.memberId}:${folderGroup.folderId || folderGroup.folderName}`;
                        const isExpanded = Boolean(expandedFolders[folderKey]);
                        const isGrouped = groupedFolders[folderKey] ?? true;
                        const visibleEntries = isGrouped ? folderGroup.entries : folderGroup.rawEntries;
                        const folderFillPercentage = getFolderFillPercentage(
                          folderGroup.totalDurationMin,
                          memberEntry.totalDurationMin
                        );

                        return (
                          <div
                            key={folderGroup.folderId || folderGroup.folderName}
                            className="team-summary-folder-group"
                            style={{ '--folder-fill-percentage': `${folderFillPercentage}%` }}
                          >
                            <div className="team-summary-folder-header">
                              <h3>{folderGroup.folderName}: {formatDurationMinutes(folderGroup.totalDurationMin)}</h3>
                              <div className="team-summary-folder-controls">
                                <button
                                  type="button"
                                  className="team-summary-toggle-button"
                                  onClick={() => toggleFolder(folderKey)}
                                >
                                  {isExpanded ? 'Hide entries' : 'Show entries'}
                                </button>
                                {isExpanded && (
                                  <button
                                    type="button"
                                    className="team-summary-toggle-button team-summary-grouping-button"
                                    onClick={() => toggleGrouping(folderKey)}
                                  >
                                    {isGrouped ? 'Disable grouping' : 'Enable grouping'}
                                  </button>
                                )}
                              </div>
                            </div>
                            {isExpanded && (
                              <ul className="team-summary-list">
                                {visibleEntries.map((entry, index) => {
                                  const entryFillPercentage = getEntryFillPercentage(
                                    isGrouped ? entry.totalDurationMin : entry.durationMin,
                                    folderGroup.totalDurationMin
                                  );
                                  const showDaySeparator = !isGrouped
                                    && index > 0
                                    && getEntryDayKey(entry.taskDate) !== getEntryDayKey(visibleEntries[index - 1].taskDate);

                                  return (
                                    <li
                                      key={isGrouped ? entry.taskName : entry.id}
                                      className={`team-summary-list-item${showDaySeparator ? ' team-summary-list-item-day-separator' : ''}`}
                                      style={{ '--entry-fill-percentage': `${entryFillPercentage}%` }}
                                    >
                                      <span>
                                        <b>{formatDurationMinutes(isGrouped ? entry.totalDurationMin : entry.durationMin)}</b> - {entry.taskName} 
                                        {isGrouped && entry.entryCount > 1 ? ` (${entry.entryCount} entries)` : ''}
                                      </span>
                                      <strong>
                                        {formatDateCode(isGrouped ? entry.latestTaskDate : entry.taskDate)}
                                      </strong>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })()
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TeamSummary;