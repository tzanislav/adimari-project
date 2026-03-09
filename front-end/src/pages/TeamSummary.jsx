import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchWithAuth, getAuthHeaders } from '../utils/authHeaders';
import '../CSS/TeamSummary.css';

const defaultProfileImage = 'https://cdn.iconscout.com/icon/free/png-256/avatar-380-456332.png';

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

function TeamSummary() {
  const { user } = useAuth();
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const [memberEntries, setMemberEntries] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleFolder = (folderKey) => {
    setExpandedFolders((currentFolders) => ({
      ...currentFolders,
      [folderKey]: !currentFolders[folderKey],
    }));
  };

  const groupEntriesByFolder = (entries) => {
    const groupedEntries = new Map();

    entries.forEach((entry) => {
      const folderKey = entry.folderId || 'no-folder';
      const existingGroup = groupedEntries.get(folderKey);

      if (existingGroup) {
        existingGroup.entries.push(entry);
        existingGroup.totalDurationMin += entry.durationMin;
        return;
      }

      groupedEntries.set(folderKey, {
        folderId: entry.folderId,
        folderName: entry.folderName || 'No Folder',
        totalDurationMin: entry.durationMin,
        entries: [entry],
      });
    });

    return Array.from(groupedEntries.values()).sort((left, right) => left.folderName.localeCompare(right.folderName));
  };

  useEffect(() => {
    const loadEntries = async () => {
      if (!user) {
        setMemberEntries([]);
        setError('Sign in to load Team Summary data.');
        return;
      }

      setLoading(true);
      setError('');

      try {
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
            const response = await fetchWithAuth(`${serverUrl}/clickup/time-entries/all/${member.id}`, {
              headers,
            });

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
      } catch (loadError) {
        console.error('Error loading team summary:', loadError);
        setError('Failed to load Team Summary data.');
      } finally {
        setLoading(false);
      }
    };

    loadEntries();
  }, [serverUrl, user]);

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
          <p>Team members with their ClickUp time entry ids and durations.</p>
        </div>
        <Link to="/team" className="team-summary-back-link">Back To Team Status</Link>
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
                              <button
                                type="button"
                                className="team-summary-toggle-button"
                                onClick={() => toggleFolder(folderKey)}
                              >
                                {isExpanded ? 'Hide entries' : 'Show entries'}
                              </button>
                            </div>
                            {isExpanded && (
                              <ul className="team-summary-list">
                                {folderGroup.entries.map((entry) => {
                                  const entryFillPercentage = getEntryFillPercentage(
                                    entry.durationMin,
                                    folderGroup.totalDurationMin
                                  );

                                  return (
                                    <li
                                      key={entry.id}
                                      className="team-summary-list-item"
                                      style={{ '--entry-fill-percentage': `${entryFillPercentage}%` }}
                                    >
                                      <span>{entry.taskName}</span>
                                      <strong>{formatDateCode(entry.taskDate)} - {formatDurationMinutes(entry.durationMin)}</strong>
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