/* eslint-disable react/prop-types */
import '../CSS/FileExplorerWorkspace.css';

const FILE_ICON_DIRECTORY = '/File%20Icons/';
const FILE_ICON_ALIASES = { docx: 'doc', xlsx: 'xls', xlsm: 'xls' };

function getFileIconName(entry) {
  if (entry?.kind === 'folder' || entry?.isFolder || entry?.isDirectory) {
    return 'folder.png';
  }

  const rawName = typeof entry?.name === 'string' ? entry.name : '';
  const extension = rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : '';
  const iconBaseName = FILE_ICON_ALIASES[extension] || extension || 'file';
  return `${iconBaseName}.png`;
}

/**
 * The neutral file icon used by both authenticated explorer adapters.
 * The component only reads the display-safe normalized entry shape.
 */
function FileExplorerFileIcon({ entry }) {
  const iconName = getFileIconName(entry);

  return (
    <img
      className="file-explorer-file-icon"
      src={`${FILE_ICON_DIRECTORY}${encodeURIComponent(iconName)}`}
      alt=""
      aria-hidden="true"
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = `${FILE_ICON_DIRECTORY}file.png`;
      }}
    />
  );
}

export default FileExplorerFileIcon;
