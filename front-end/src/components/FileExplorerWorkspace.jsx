/* eslint-disable react/prop-types */
import '../CSS/FileExplorerWorkspace.css';

const entryIsFolder = (entry) => entry?.kind === 'folder' || entry?.isFolder === true || entry?.isDirectory === true;

const entryKey = (entry, index) => entry?.id ?? entry?.path ?? entry?.relativePath ?? entry?.key ?? `${entry?.name || 'entry'}-${index}`;

const breadcrumbKey = (breadcrumb, index) => breadcrumb?.id ?? breadcrumb?.path ?? breadcrumb?.value ?? `${breadcrumb?.label || 'breadcrumb'}-${index}`;

const getSortDirection = (column, sort) => {
  if (sort?.key !== column) return 'none';
  return sort.direction === 'desc' ? 'descending' : 'ascending';
};

const getSortButtonLabel = (column, label, sort) => {
  const direction = getSortDirection(column, sort);
  if (direction === 'none') return `Sort by ${label}`;
  return `${label}, currently sorted ${direction}. Activate to reverse the order`;
};

function SortHeader({ column, label, sort, onSortChange }) {
  const ariaSort = getSortDirection(column, sort);

  return (
    <div className="file-explorer-workspace__heading-cell" role="columnheader" aria-sort={ariaSort}>
      {onSortChange ? (
        <button
          className="file-explorer-workspace__sort-button"
          type="button"
          onClick={() => onSortChange(column)}
          aria-label={getSortButtonLabel(column, label, sort)}
        >
          <span>{label}</span>
          <span className="file-explorer-workspace__sort-indicator" aria-hidden="true">
            {ariaSort === 'ascending' ? '↑' : ariaSort === 'descending' ? '↓' : '↕'}
          </span>
        </button>
      ) : <span>{label}</span>}
    </div>
  );
}

/**
 * A presentation-only workspace for the common upload space and folder table.
 *
 * `entries` must already be ordered by the adapter. In particular, adapters
 * should keep folders before files when applying `sort`.
 *
 * Normalized entry shape:
 * { id, kind: 'folder' | 'file', name, path, sizeBytes, modifiedAt }
 * `isDirectory` is also accepted while adapters are being migrated.
 */
function FileExplorerWorkspace({
  className = '',
  upload,
  breadcrumbs = [],
  onNavigateBreadcrumb,
  navigationDisabled = false,
  entries = [],
  renderEntryIcon,
  renderEntryName,
  renderSize,
  renderModified,
  renderRowStatus,
  renderRowActions,
  onOpenFolder,
  onOpenFile,
  isFileOpenable,
  loading = false,
  loadingLabel = 'Loading files…',
  emptyLabel = 'This folder is empty.',
  pagination,
  sort,
  onSortChange,
  browserAriaLabel = 'File explorer',
  breadcrumbsAriaLabel = 'File location',
  folderSizeLabel = 'Folder',
  emptyValue = '—',
}) {
  const hasStatusColumn = typeof renderRowStatus === 'function';
  const hasActionsColumn = typeof renderRowActions === 'function';
  const hasPagination = Boolean(pagination?.hasMore && pagination?.onLoadMore);
  const hasUploadCopy = Boolean(upload?.title || upload?.description);
  const browserClasses = [
    'file-explorer-workspace__browser',
    hasStatusColumn && 'file-explorer-workspace__browser--with-status',
    hasActionsColumn && 'file-explorer-workspace__browser--with-actions',
  ].filter(Boolean).join(' ');

  const renderName = (entry) => {
    if (typeof renderEntryName === 'function') return renderEntryName(entry);

    return (
      <>
        {typeof renderEntryIcon === 'function' && renderEntryIcon(entry)}
        <span className="file-explorer-workspace__entry-label">{entry.name}</span>
      </>
    );
  };

  const renderEntry = (entry, index) => {
    const isFolder = entryIsFolder(entry);
    const canOpenFile = !isFolder
      && typeof onOpenFile === 'function'
      && (typeof isFileOpenable === 'function' ? isFileOpenable(entry) : true);
    const canOpenFolder = isFolder && typeof onOpenFolder === 'function';
    const isFolderNavigationDisabled = canOpenFolder && navigationDisabled;
    const hasNameButton = canOpenFolder || canOpenFile;
    const isOpenable = (canOpenFolder && !navigationDisabled) || canOpenFile;
    const openEntry = () => {
      if (isFolder) {
        if (!navigationDisabled) onOpenFolder?.(entry);
        return;
      }
      onOpenFile?.(entry);
    };

    return (
      <article
        className={`file-explorer-workspace__row${isFolder ? ' is-folder' : ''}${isOpenable ? ' is-openable' : ''}`}
        key={entryKey(entry, index)}
        role="row"
      >
        <div className="file-explorer-workspace__entry-name" role="cell">
          {hasNameButton ? (
            <button
              className="file-explorer-workspace__name-button"
              type="button"
              disabled={isFolderNavigationDisabled}
              onClick={openEntry}
              aria-label={`${isFolder ? 'Open folder' : 'Open file'} ${entry.name}`}
            >
              {renderName(entry)}
            </button>
          ) : renderName(entry)}
        </div>
        <span className="file-explorer-workspace__entry-meta" role="cell">
          {typeof renderSize === 'function'
            ? renderSize(entry)
            : isFolder ? folderSizeLabel : entry.sizeLabel ?? emptyValue}
        </span>
        <span className="file-explorer-workspace__entry-meta" role="cell">
          {typeof renderModified === 'function' ? renderModified(entry) : entry.modifiedLabel ?? emptyValue}
        </span>
        {hasStatusColumn && (
          <div className="file-explorer-workspace__entry-status" role="cell">
            {renderRowStatus(entry)}
          </div>
        )}
        {hasActionsColumn && (
          <div className="file-explorer-workspace__entry-actions" role="cell">
            {renderRowActions(entry)}
          </div>
        )}
      </article>
    );
  };

  return (
    <section className={`file-explorer-workspace${className ? ` ${className}` : ''}`}>
      {upload && (
        <section
          className={`file-explorer-workspace__upload${upload.className ? ` ${upload.className}` : ''}`}
          aria-label={upload.ariaLabel || 'Upload files'}
        >
          {(hasUploadCopy || upload.actions) && (
            <div className="file-explorer-workspace__upload-heading">
              {hasUploadCopy && <div>
                {upload.title && <h2>{upload.title}</h2>}
                {upload.description && <p>{upload.description}</p>}
              </div>}
              {upload.actions && <div className="file-explorer-workspace__upload-actions">{upload.actions}</div>}
            </div>
          )}
          {upload.dropzone && (
            <div
              className={`file-explorer-workspace__dropzone${upload.dropzone.className ? ` ${upload.dropzone.className}` : ''}${upload.dropzone.isDragging ? ' is-dragging' : ''}${upload.dropzone.disabled ? ' is-disabled' : ''}`}
              aria-disabled={upload.dropzone.disabled || undefined}
              onDragEnter={upload.dropzone.onDragEnter}
              onDragOver={upload.dropzone.onDragOver}
              onDragLeave={upload.dropzone.onDragLeave}
              onDrop={upload.dropzone.onDrop}
            >
              {upload.dropzone.label && <strong>{upload.dropzone.label}</strong>}
              {upload.dropzone.description && <span>{upload.dropzone.description}</span>}
            </div>
          )}
          {upload.children}
        </section>
      )}

      {breadcrumbs.length > 0 && (
        <nav className="file-explorer-workspace__breadcrumbs" aria-label={breadcrumbsAriaLabel}>
          {breadcrumbs.map((breadcrumb, index) => {
            const isCurrent = Boolean(breadcrumb.current || breadcrumb.disabled);
            const isNavigable = typeof onNavigateBreadcrumb === 'function' && !isCurrent;

            return (
              <span className="file-explorer-workspace__breadcrumb" key={breadcrumbKey(breadcrumb, index)}>
                {index > 0 && <span className="file-explorer-workspace__breadcrumb-separator" aria-hidden="true">/</span>}
                {isNavigable ? (
                  <button type="button" disabled={navigationDisabled} onClick={() => onNavigateBreadcrumb(breadcrumb)}>{breadcrumb.label}</button>
                ) : <span aria-current={isCurrent ? 'page' : undefined}>{breadcrumb.label}</span>}
              </span>
            );
          })}
        </nav>
      )}

      <section className={browserClasses} role="table" aria-label={browserAriaLabel}>
        <div role="rowgroup">
          <div className="file-explorer-workspace__heading" role="row">
            <SortHeader column="name" label="Name" sort={sort} onSortChange={onSortChange} />
            <SortHeader column="size" label="Size" sort={sort} onSortChange={onSortChange} />
            <SortHeader column="modified" label="Modified" sort={sort} onSortChange={onSortChange} />
            {hasStatusColumn && <div className="file-explorer-workspace__heading-cell" role="columnheader">Status</div>}
            {hasActionsColumn && <div className="file-explorer-workspace__heading-cell" role="columnheader">Actions</div>}
          </div>
        </div>
        <div role="rowgroup">
          {loading ? (
            <div className="file-explorer-workspace__empty-row" role="row">
              <div className="file-explorer-workspace__empty" role="cell">{loadingLabel}</div>
            </div>
          ) : (
            <>
              {entries.map(renderEntry)}
              {!entries.length && (
                <div className="file-explorer-workspace__empty-row" role="row">
                  <div className="file-explorer-workspace__empty" role="cell">{emptyLabel}</div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {hasPagination && (
        <button
          className="file-explorer-workspace__load-more"
          type="button"
          disabled={pagination.loading}
          onClick={pagination.onLoadMore}
        >
          {pagination.loading ? pagination.loadingLabel || 'Loading…' : pagination.label || 'Load more'}
        </button>
      )}
    </section>
  );
}

export default FileExplorerWorkspace;
