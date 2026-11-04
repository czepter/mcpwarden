import { closeGateway } from '../mcp/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', closeGateway)
})
