import ProjectLinkCard from '../components/ProjectLinkCard';
import '../CSS/Projects.css';

const projectLinks = [
  {
    title: 'Selection',
    description: 'Browse and manage your existing project selections.',
    to: '/projects/selection',
    thumbnail: null,
  },
  {
    title: 'Stair Calculator',
    description: 'Plan comfortable stair proportions using the ideal slope formula.',
    to: '/projects/stair-calculator',
    thumbnail: null,
  },
  {
    title: 'History Around',
    description: 'Explore the History Around application.',
    href: 'https://historyaround.com',
    thumbnail: null,
  },
  {
    title: 'Gaussian Splat',
    description: 'Explore the Gaussian Splat 3D viewer.',
    href: 'https://3dsplatviewer.com',
    thumbnail: null,
  },
  {
    title: 'Nesting App',
    description: 'Open the nesting application and its project workspace.',
    href: 'http://ec2-54-76-118-84.eu-west-1.compute.amazonaws.com',
    thumbnail: null,
  },
];

function Projects() {
  return (
    <main className="project-directory">
      <h1>Projects</h1>
      <p className="project-directory-intro">Choose a project to continue.</p>
      <div className="project-link-card-grid">
        {projectLinks.map((project) => (
          <ProjectLinkCard key={project.title} {...project} />
        ))}
      </div>
    </main>
  );
}

export default Projects;
