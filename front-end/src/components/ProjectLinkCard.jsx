/* eslint-disable react/prop-types */
import { Link } from 'react-router-dom';

function ProjectLinkCard({ title, description, thumbnail = null, thumbnailAlt = '', thumbnailPlaceholder = 'Thumbnail', to, href }) {
  const cardContent = (
    <>
      <div className="project-link-card-thumbnail">
        {thumbnail ? (
          <img src={thumbnail} alt={thumbnailAlt || `${title} thumbnail`} />
        ) : (
          <span aria-hidden="true">{thumbnailPlaceholder}</span>
        )}
      </div>
      <div className="project-link-card-content">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </>
  );

  if (href) {
    return (
      <a className="project-link-card" href={href} target="_blank" rel="noreferrer">
        {cardContent}
      </a>
    );
  }

  return (
    <Link className="project-link-card" to={to}>
      {cardContent}
    </Link>
  );
}

export default ProjectLinkCard;
