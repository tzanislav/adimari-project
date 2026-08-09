import ProjectLinkCard from '../components/ProjectLinkCard';
import '../CSS/Projects.css';

const projectLinks = [
  {
    title: '3D Models',
    description: 'Browse and manage the library of 3D models.',
    to: '/items',
    thumbnail: '/3d.png',
    thumbnailAlt: '3D cube',
  },
  {
    title: 'Selection',
    description: 'Browse and manage your existing project selections.',
    to: '/projects/selection',
    thumbnail: '/select.png',
  },
  {
    title: 'Stair Calculator',
    description: 'Plan comfortable stair proportions using the ideal slope formula.',
    to: '/projects/stair-calculator',
    thumbnail: '/man-climbing-stairs.png',
    thumbnailAlt: 'Person climbing a staircase',
  },
  {
    title: 'History Around',
    description: 'Explore the History Around application.',
    href: 'https://historyaround.com',
    thumbnail: '/column.png',
  },
  {
    title: 'Gaussian Splat',
    description: 'Explore the Gaussian Splat 3D viewer.',
    href: 'https://3dsplatviewer.com',
    thumbnail: '/gauss.png',
  },
  {
    title: 'Nesting App',
    description: 'Open the nesting application and its project workspace.',
    href: 'http://ec2-54-76-118-84.eu-west-1.compute.amazonaws.com',
    thumbnail: '/nest.png',
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
