/* eslint-disable react/prop-types */
import { Link } from 'react-router-dom';
import { projectThumbnailUrl } from '../utils/projectDirectory';

function ProjectLinkCard({ title, description, thumbnail = null, thumbnailAlt = '', link }) {
  const cardContent = (
    <>
      <div className="project-link-card-thumbnail">
        {thumbnail ? (
          <img src={projectThumbnailUrl(thumbnail)} alt={thumbnailAlt || `${title} thumbnail`} />
        ) : (
          <span aria-hidden="true">{title.slice(0, 2)}</span>
        )}
      </div>
      <div className="project-link-card-content">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </>
  );

  if (link.type === 'external') {
    return (
      <a className="project-link-card" href={link.value} target="_blank" rel="noreferrer">
        {cardContent}
      </a>
    );
  }

  return (
    <Link className="project-link-card" to={link.value}>
      {cardContent}
    </Link>
  );
}

export default ProjectLinkCard;
