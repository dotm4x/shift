import { Command } from 'commander'

import { loadWorkspaceProjects } from '@livescript/project'

/**
 * Creates the command that manages workspaces.
 *
 * @returns The workspace command.
 */
export function workspaceCommand(): Command {
  const command = new Command('workspace').description('Manage workspaces')

  command
    .command('list')
    .description('List projects in the current workspace in build order')
    .action(() => {
      try {
        const projects = loadWorkspaceProjects(process.cwd())

        if (projects.length === 0) {
          console.log('The workspace has no projects.')

          return
        }

        for (const project of projects) {
          console.log(`${project.name}@${project.version}  ${project.root}`)
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  return command
}
