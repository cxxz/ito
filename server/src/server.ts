import http2 from 'node:http2'
import { fastify } from 'fastify'
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify'
import { createContextValues } from '@connectrpc/connect'
import itoServiceRoutes from './services/ito/itoService.js'
import { kUser } from './auth/userContext.js'
import { errorInterceptor } from './services/errorInterceptor.js'
import { loggingInterceptor } from './services/loggingInterceptor.js'
import { createValidationInterceptor } from './services/validationInterceptor.js'
import dotenv from 'dotenv'
import cors from '@fastify/cors'

dotenv.config()

// Create the main server function
export const startServer = async () => {
  const connectRpcServer = fastify({
    logger: process.env.SHOW_ALL_REQUEST_LOGS === 'true',
    trustProxy: true,
    // Use serverFactory to create HTTP/2 server manually.
    // This avoids a Fastify bug where session close handlers have incorrect `this` binding
    // causing "TypeError: this.close is not a function" errors after stream completion.
    serverFactory: handler => {
      return http2.createServer(handler)
    },
  })

  await connectRpcServer.register(cors, { origin: '*' })

  // Self-hosted mode: no authentication required
  console.log('Running in self-hosted mode (no authentication)')

  // Register Connect RPC plugin
  await connectRpcServer.register(async function (fastify) {
    if (process.env.SHOW_CLIENT_LOGS === 'true') {
      console.log('SHOW_CLIENT_LOGS is ENABLED.')
    } else {
      console.log('SHOW_CLIENT_LOGS is DISABLED.')
    }

    if (process.env.SHOW_ALL_REQUEST_LOGS === 'true') {
      console.log('SHOW_ALL_REQUEST_LOGS is ENABLED.')
    } else {
      console.log('SHOW_ALL_REQUEST_LOGS is DISABLED.')
    }

    // Register the Connect RPC plugin with our service routes and interceptors
    await fastify.register(fastifyConnectPlugin, {
      routes: router => {
        itoServiceRoutes(router)
      },
      // Order matters: logging -> validation -> error handling
      interceptors: [
        loggingInterceptor,
        createValidationInterceptor(),
        errorInterceptor,
      ],
      contextValues: () => {
        // Self-hosted mode: always use self-hosted user
        return createContextValues().set(kUser, { sub: 'self-hosted' })
      },
    })
  })

  // Error handling - this handles Fastify-level errors, not RPC errors
  connectRpcServer.setErrorHandler((error, _, reply) => {
    connectRpcServer.log.error(error)
    reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message,
    })
  })

  // Basic REST route for health check
  connectRpcServer.get('/', async (_, reply) => {
    reply.type('text/plain')
    reply.send('Welcome to the Ito Connect RPC server (self-hosted)!')
  })

  // Start the server
  const rpcPort = Number(process.env.PORT) || 3003
  const host = '0.0.0.0'

  try {
    await Promise.all([connectRpcServer.listen({ port: rpcPort, host })])
    console.log(`🚀 Connect RPC server listening on ${host}:${rpcPort}`)
  } catch (err) {
    connectRpcServer.log.error(err)
    process.exit(1)
  }
}
