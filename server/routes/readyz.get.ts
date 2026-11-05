import { isReady } from '../utils/ready'

export default defineEventHandler((event) => {
  if (!isReady()) setResponseStatus(event, 503)
  return { ready: isReady() }
})
