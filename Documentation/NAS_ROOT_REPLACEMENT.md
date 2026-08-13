# NAS root replacement

A connected Connector root is intentionally immutable. Changing a native path
while retaining its logical root ID can mix files from two NAS folders in one
catalogue, so normal **Save setup** rejects such an edit after the Connector
has connected.

The replacement workflow is deliberately explicit:

1. Wait for the local queue to be empty. Do not clear a running file job.
2. Disable the existing root in NAS Connectors so its catalogue and shares
   remain associated with a disabled, historical source.
3. Install/connect a new Connector identity for the replacement folder.
4. Run a full scan before making the new root available to users.

No existing catalogue rows, shares, or cache records are transferred to the
replacement root. An automated root-identity rotation is a later dedicated
change; until then, this manual flow is the only supported operation and is
safer than editing a connected native path.
