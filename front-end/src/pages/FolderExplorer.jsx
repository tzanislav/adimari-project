import '../CSS/FileServer.css';

function FolderExplorer() {
  return (
    <main className="file-server-page">
      <header className="file-server-header">
        <div>
          <p className="file-server-eyebrow">Project workspace</p>
          <h1>Folder Explorer</h1>
          <p>The folder explorer will connect to its separate application when the link is available.</p>
        </div>
      </header>
      <section className="file-server-browser" aria-label="Folder explorer">
        <div className="file-server-browser-heading">
          <span>Name</span><span>Size</span><span>Modified</span><span>Actions</span>
        </div>
        <p className="file-server-empty">The connection has moved to its own application. A link will be added here.</p>
      </section>
    </main>
  );
}

export default FolderExplorer;
