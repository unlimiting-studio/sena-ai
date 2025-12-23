<page>
---
title: Overview · Cloudflare Containers docs
description: Run code written in any programming language, built for any
  runtime, as part of apps built on Workers.
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/
  md: https://developers.cloudflare.com/containers/index.md
---

Enhance your Workers with serverless containers

Available on Workers Paid plan

Run code written in any programming language, built for any runtime, as part of apps built on [Workers](https://developers.cloudflare.com/workers).

Deploy your container image to Region:Earth without worrying about managing infrastructure - just define your Worker and `wrangler deploy`.

With Containers you can run:

* Resource-intensive applications that require CPU cores running in parallel, large amounts of memory or disk space
* Applications and libraries that require a full filesystem, specific runtime, or Linux-like environment
* Existing applications and tools that have been distributed as container images

Container instances are spun up on-demand and controlled by code you write in your [Worker](https://developers.cloudflare.com/workers). Instead of chaining together API calls or writing Kubernetes operators, you just write JavaScript:

* Worker Code

  ```js
  import { Container, getContainer } from "@cloudflare/containers";


  export class MyContainer extends Container {
    defaultPort = 4000; // Port the container is listening on
    sleepAfter = "10m"; // Stop the instance if requests not sent for 10 minutes
  }


  export default {
    async fetch(request, env) {
      const { "session-id": sessionId } = await request.json();
      // Get the container instance for the given session ID
      const containerInstance = getContainer(env.MY_CONTAINER, sessionId);
      // Pass the request to the container instance on its default port
      return containerInstance.fetch(request);
    },
  };
  ```

* Worker Config

  * wrangler.jsonc

    ```jsonc
    {
      "name": "container-starter",
      "main": "src/index.js",
      "compatibility_date": "2025-12-23",
      "containers": [
        {
          "class_name": "MyContainer",
          "image": "./Dockerfile",
          "max_instances": 5
        }
      ],
      "durable_objects": {
        "bindings": [
          {
            "class_name": "MyContainer",
            "name": "MY_CONTAINER"
          }
        ]
      },
      "migrations": [
        {
          "new_sqlite_classes": ["MyContainer"],
          "tag": "v1"
        }
      ]
    }
    ```

  * wrangler.toml

    ```toml
    name = "container-starter"
    main = "src/index.js"
    compatibility_date = "2025-12-23"


    [[containers]]
    class_name = "MyContainer"
    image = "./Dockerfile"
    max_instances = 5


    [[durable_objects.bindings]]
    class_name = "MyContainer"
    name = "MY_CONTAINER"


    [[migrations]]
    new_sqlite_classes = [ "MyContainer" ]
    tag = "v1"
    ```

* wrangler.jsonc

  ```jsonc
  {
    "name": "container-starter",
    "main": "src/index.js",
    "compatibility_date": "2025-12-23",
    "containers": [
      {
        "class_name": "MyContainer",
        "image": "./Dockerfile",
        "max_instances": 5
      }
    ],
    "durable_objects": {
      "bindings": [
        {
          "class_name": "MyContainer",
          "name": "MY_CONTAINER"
        }
      ]
    },
    "migrations": [
      {
        "new_sqlite_classes": ["MyContainer"],
        "tag": "v1"
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  name = "container-starter"
  main = "src/index.js"
  compatibility_date = "2025-12-23"


  [[containers]]
  class_name = "MyContainer"
  image = "./Dockerfile"
  max_instances = 5


  [[durable_objects.bindings]]
  class_name = "MyContainer"
  name = "MY_CONTAINER"


  [[migrations]]
  new_sqlite_classes = [ "MyContainer" ]
  tag = "v1"
  ```

[Get started](https://developers.cloudflare.com/containers/get-started/)

[Containers dashboard](https://dash.cloudflare.com/?to=/:account/workers/containers)

***

## Next Steps

### Deploy your first Container

Build and push an image, call a Container from a Worker, and understand scaling and routing.

[Deploy a Container](https://developers.cloudflare.com/containers/get-started/)

### Container Examples

See examples of how to use a Container with a Worker, including stateless and stateful routing, regional placement, Workflow and Queue integrations, AI-generated code execution, and short-lived workloads.

[See Examples](https://developers.cloudflare.com/containers/examples/)

***

## More resources

[Beta Information](https://developers.cloudflare.com/containers/beta-info/)

Learn about the Containers Beta and upcoming features.

[Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/#containers)

Learn more about the commands to develop, build and push images, and deploy containers with Wrangler.

[Limits](https://developers.cloudflare.com/containers/platform-details/#limits)

Learn about what limits Containers have and how to work within them.

[Containers Discord](https://discord.cloudflare.com)

Connect with other users of Containers on Discord. Ask questions, show what you are building, and discuss the platform with other developers.

</page>

<page>
---
title: 404 - Page Not Found · Cloudflare Containers docs
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/404/
  md: https://developers.cloudflare.com/containers/404/index.md
---

# 404

Check the URL, try using our [search](https://developers.cloudflare.com/search/) or try our LLM-friendly [llms.txt directory](https://developers.cloudflare.com/llms.txt).

</page>

<page>
---
title: Beta Info & Roadmap · Cloudflare Containers docs
description: "Currently, Containers are in beta. There are several changes we
  plan to make prior to GA:"
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/beta-info/
  md: https://developers.cloudflare.com/containers/beta-info/index.md
---

Currently, Containers are in beta. There are several changes we plan to make prior to GA:

## Upcoming Changes and Known Gaps

### Limits

Container limits will be raised in the future. We plan to increase both maximum instance size and maximum number of instances in an account.

See the [Limits documentation](https://developers.cloudflare.com/containers/platform-details/#limits) for more information.

### Autoscaling and load balancing

Currently, Containers are not autoscaled or load balanced. Containers can be scaled manually by calling `get()` on their binding with a unique ID.

We plan to add official support for utilization-based autoscaling and latency-aware load balancing in the future.

See the [Autoscaling documentation](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing) for more information.

### Reduction of log noise

Currently, the `Container` class uses Durable Object alarms to help manage Container shutdown. This results in unnecessary log noise in the Worker logs. You can filter these logs out in the dashboard by adding a Query, but this is not ideal.

We plan to automatically reduce log noise in the future.

### Dashboard Updates

The dashboard will be updated to show:

* links from Workers to their associated Containers

### Co-locating Durable Objects and Containers

Currently, Durable Objects are not co-located with their associated Container. When requesting a container, the Durable Object will find one close to it, but not on the same machine.

We plan to co-locate Durable Objects with their Container in the future.

### More advanced Container placement

We currently prewarm servers across our global network with container images to ensure quick start times. There are times in which you may request a new container and it will be started in a location that farther from the end user than is desired. We are optimizing this process to ensure that this happens as little as possible, but it may still occur.

### Atomic code updates across Workers and Containers

When deploying a Container with `wrangler deploy`, the Worker code will be immediately updated while the Container code will slowly be updated using a rolling deploy.

This means that you must ensure Worker code is backwards compatible with the old Container code.

In the future, Worker code in the Durable Object will only update when associated Container code updates.

## Feedback wanted

There are several areas where we wish to gather feedback from users:

* Do you want to integrate Containers with any other Cloudflare services? If so, which ones and how?
* Do you want more ways to interact with a Container via Workers? If so, how?
* Do you need different mechanisms for routing requests to containers?
* Do you need different mechanisms for scaling containers? (see [scaling documentation](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing) for information on autoscaling plans)

At any point during the Beta, feel free to [give feedback using this form](https://forms.gle/CscdaEGuw5Hb6H2s7).

</page>

<page>
---
title: Container Package · Cloudflare Containers docs
description: >-
  When writing code that interacts with a container instance, you can either use
  a

  Durable Object directly or use the Container class

  importable from @cloudflare/containers.
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/container-package/
  md: https://developers.cloudflare.com/containers/container-package/index.md
---

When writing code that interacts with a container instance, you can either use a [Durable Object directly](https://developers.cloudflare.com/containers/platform-details/durable-object-methods) or use the [`Container` class](https://github.com/cloudflare/containers) importable from [`@cloudflare/containers`](https://www.npmjs.com/package/@cloudflare/containers).

We recommend using the `Container` class for most use cases.

* npm

  ```sh
  npm i @cloudflare/containers
  ```

* yarn

  ```sh
  yarn add @cloudflare/containers
  ```

* pnpm

  ```sh
  pnpm add @cloudflare/containers
  ```

Then, you can define a class that extends `Container`, and use it in your Worker:

```javascript
import { Container } from "@cloudflare/containers";


class MyContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}


export default {
  async fetch(request, env) {
    // gets default instance and forwards request from outside Worker
    return env.MY_CONTAINER.getByName("hello").fetch(request);
  },
};
```

The `Container` class extends `DurableObject` so all [Durable Object](https://developers.cloudflare.com/durable-objects) functionality is available. It also provides additional functionality and a nice interface for common container behaviors, such as:

* sleeping instances after an inactivity timeout
* making requests to specific ports
* running status hooks on startup, stop, or error
* awaiting specific ports before making requests
* setting environment variables and secrets

See the [Containers GitHub repo](https://github.com/cloudflare/containers) for more details and the complete API.

</page>

<page>
---
title: Examples · Cloudflare Containers docs
description: "Explore the following examples of Container functionality:"
lastUpdated: 2025-08-18T14:27:42.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/
  md: https://developers.cloudflare.com/containers/examples/index.md
---

Explore the following examples of Container functionality:

[Static Frontend, Container Backend](https://developers.cloudflare.com/containers/examples/container-backend/)

[A simple frontend app with a containerized backend](https://developers.cloudflare.com/containers/examples/container-backend/)

[Cron Container](https://developers.cloudflare.com/containers/examples/cron/)

[Running a container on a schedule using Cron Triggers](https://developers.cloudflare.com/containers/examples/cron/)

[Using Durable Objects Directly](https://developers.cloudflare.com/containers/examples/durable-object-interface/)

[Various examples calling Containers directly from Durable Objects](https://developers.cloudflare.com/containers/examples/durable-object-interface/)

[Env Vars and Secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)

[Pass in environment variables and secrets to your container](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)

[Mount R2 buckets with FUSE](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)

[Mount R2 buckets as filesystems using FUSE in Containers](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)

[Stateless Instances](https://developers.cloudflare.com/containers/examples/stateless/)

[Run multiple instances across Cloudflare's network](https://developers.cloudflare.com/containers/examples/stateless/)

[Status Hooks](https://developers.cloudflare.com/containers/examples/status-hooks/)

[Execute Workers code in reaction to Container status changes](https://developers.cloudflare.com/containers/examples/status-hooks/)

[Websocket to Container](https://developers.cloudflare.com/containers/examples/websocket/)

[Forwarding a Websocket request to a Container](https://developers.cloudflare.com/containers/examples/websocket/)

</page>

<page>
---
title: Frequently Asked Questions · Cloudflare Containers docs
description: "Frequently Asked Questions:"
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/faq/
  md: https://developers.cloudflare.com/containers/faq/index.md
---

Frequently Asked Questions:

## How do Container logs work?

To get logs in the Dashboard, including live tailing of logs, toggle `observability` to true in your Worker's wrangler config:

* wrangler.jsonc

  ```jsonc
  {
    "observability": {
      "enabled": true
    }
  }
  ```

* wrangler.toml

  ```toml
  [observability]
  enabled = true
  ```

Logs are subject to the same [limits as Worker logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#limits), which means that they are retained for 3 days on Free plans and 7 days on Paid plans.

See [Workers Logs Pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing) for details on cost.

If you are an Enterprise user, you are able to export container logs via [Logpush](https://developers.cloudflare.com/logs/logpush/) to your preferred destination.

## How are container instance locations selected?

When initially deploying a Container, Cloudflare will select various locations across our network to deploy instances to. These locations will span multiple regions.

When a Container instance is requested with `this.ctx.container.start`, the nearest free container instance will be selected from the pre-initialized locations. This will likely be in the same region as the external request, but may not be. Once the container instance is running, any future requests will be routed to the initial location.

An Example:

* A user deploys a Container. Cloudflare automatically readies instances across its Network.
* A request is made from a client in Bariloche, Argentia. It reaches the Worker in Cloudflare's location in Neuquen, Argentina.
* This Worker request calls `MY_CONTAINER.get("session-1337")` which brings up a Durable Object, which then calls `this.ctx.container.start`.
* This requests the nearest free Container instance.
* Cloudflare recognizes that an instance is free in Buenos Aires, Argentina, and starts it there.
* A different user needs to route to the same container. This user's request reaches the Worker running in Cloudflare's location in San Diego.
* The Worker again calls `MY_CONTAINER.get("session-1337")`.
* If the initial container instance is still running, the request is routed to the location in Buenos Aires. If the initial container has gone to sleep, Cloudflare will once again try to find the nearest "free" instance of the Container, likely one in North America, and start an instance there.

## How do container updates and rollouts work?

See [rollout documentation](https://developers.cloudflare.com/containers/platform-details/rollouts/) for details.

## How does scaling work?

See [scaling & routing documentation](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/) for details.

## What are cold starts? How fast are they?

A cold start is when a container instance is started from a completely stopped state.

If you call `env.MY_CONTAINER.get(id)` with a completely novel ID and launch this instance for the first time, it will result in a cold start.

This will start the container image from its entrypoint for the first time. Depending on what this entrypoint does, it will take a variable amount of time to start.

Container cold starts can often be the 2-3 second range, but this is dependent on image size and code execution time, among other factors.

## How do I use an existing container image?

See [image management documentation](https://developers.cloudflare.com/containers/platform-details/image-management/#using-existing-images) for details.

## Is disk persistent? What happens to my disk when my container sleeps?

All disk is ephemeral. When a Container instance goes to sleep, the next time it is started, it will have a fresh disk as defined by its container image.

Persistent disk is something the Cloudflare team is exploring in the future, but is not slated for the near term.

## What happens if I run out of memory?

If you run out of memory, your instance will throw an Out of Memory (OOM) error and will be restarted.

Containers do not use swap memory.

## How long can instances run for? What happens when a host server is shutdown?

Cloudflare will not actively shut off a container instance after a specific amount of time. If you do not set `sleepAfter` on your Container class, or stop the instance manually, it will continue to run unless its host server is restarted. This happens on an irregular cadence, but frequently enough where Cloudflare does not guarantee that any instance will run for any set period of time.

When a container instance is going to be shut down, it is sent a `SIGTERM` signal, and then a `SIGKILL` signal after 15 minutes. You should perform any necessary cleanup to ensure a graceful shutdown in this time. The container instance will be rebooted elsewhere shortly after this.

## How can I pass secrets to my container?

You can use [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) or the [Secrets Store](https://developers.cloudflare.com/secrets-store/integrations/workers/) to define secrets for your Workers.

Then you can pass these secrets to your Container using the `envVars` property:

```javascript
class MyContainer extends Container {
  defaultPort = 5000;
  envVars = {
    MY_SECRET: this.env.MY_SECRET,
  };
}
```

Or when starting a Container instance on a Durable Object:

```javascript
this.ctx.container.start({
  env: {
    MY_SECRET: this.env.MY_SECRET,
  },
});
```

See [the Env Vars and Secrets Example](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/) for details.

## How do I allow or disallow egress from my container?

When booting a Container, you can specify `enableInternet`, which will toggle internet access on or off.

To disable it, configure it on your Container class:

```javascript
class MyContainer extends Container {
  defaultPort = 7000;
  enableInternet = false;
}
```

or when starting a Container instance on a Durable Object:

```javascript
this.ctx.container.start({
  enableInternet: false,
});
```

</page>

<page>
---
title: Getting started · Cloudflare Containers docs
description: >-
  In this guide, you will deploy a Worker that can make requests to one or more
  Containers in response to end-user requests.

  In this example, each container runs a small webserver written in Go.
lastUpdated: 2025-10-21T14:02:11.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/get-started/
  md: https://developers.cloudflare.com/containers/get-started/index.md
---

In this guide, you will deploy a Worker that can make requests to one or more Containers in response to end-user requests. In this example, each container runs a small webserver written in Go.

This example Worker should give you a sense for simple Container use, and provide a starting point for more complex use cases.

## Prerequisites

### Ensure Docker is running locally

In this guide, we will build and push a container image alongside your Worker code. By default, this process uses [Docker](https://www.docker.com/) to do so.

You must have Docker running locally when you run `wrangler deploy`. For most people, the best way to install Docker is to follow the [docs for installing Docker Desktop](https://docs.docker.com/desktop/). Other tools like [Colima](https://github.com/abiosoft/colima) may also work.

You can check that Docker is running properly by running the `docker info` command in your terminal. If Docker is running, the command will succeed. If Docker is not running, the `docker info` command will hang or return an error including the message "Cannot connect to the Docker daemon".

## Deploy your first Container

Run the following command to create and deploy a new Worker with a container, from the starter template:

* npm

  ```sh
  npm create cloudflare@latest -- --template=cloudflare/templates/containers-template
  ```

* yarn

  ```sh
  yarn create cloudflare --template=cloudflare/templates/containers-template
  ```

* pnpm

  ```sh
  pnpm create cloudflare@latest --template=cloudflare/templates/containers-template
  ```

When you want to deploy a code change to either the Worker or Container code, you can run the following command using [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/):

* npm

  ```sh
  npx wrangler deploy
  ```

* yarn

  ```sh
  yarn wrangler deploy
  ```

* pnpm

  ```sh
  pnpm wrangler deploy
  ```

When you run `wrangler deploy`, the following things happen:

* Wrangler builds your container image using Docker.
* Wrangler pushes your image to a [Container Image Registry](https://developers.cloudflare.com/containers/platform-details/image-management/) that is automatically integrated with your Cloudflare account.
* Wrangler deploys your Worker, and configures Cloudflare's network to be ready to spawn instances of your container

The build and push usually take the longest on the first deploy. Subsequent deploys are faster, because they [reuse cached image layers](https://docs.docker.com/build/cache/).

Note

After you deploy your Worker for the first time, you will need to wait several minutes until it is ready to receive requests. Unlike Workers, Containers take a few minutes to be provisioned. During this time, requests are sent to the Worker, but calls to the Container will error.

### Check deployment status

After deploying, run the following command to show a list of containers containers in your Cloudflare account, and their deployment status:

* npm

  ```sh
  npx wrangler containers list
  ```

* yarn

  ```sh
  yarn wrangler containers list
  ```

* pnpm

  ```sh
  pnpm wrangler containers list
  ```

And see images deployed to the Cloudflare Registry with the following command:

* npm

  ```sh
  npx wrangler containers images list
  ```

* yarn

  ```sh
  yarn wrangler containers images list
  ```

* pnpm

  ```sh
  pnpm wrangler containers images list
  ```

### Make requests to Containers

Now, open the URL for your Worker. It should look something like `https://hello-containers.YOUR_ACCOUNT_NAME.workers.dev`.

If you make requests to the paths `/container/1` or `/container/2`, your Worker routes requests to specific containers. Each different path after "/container/" routes to a unique container.

If you make requests to `/lb`, you will load balanace requests to one of 3 containers chosen at random.

You can confirm this behavior by reading the output of each request.

## Understanding the Code

Now that you've deployed your first container, let's explain what is happening in your Worker's code, in your configuration file, in your container's code, and how requests are routed.

## Each Container is backed by its own Durable Object

Incoming requests are initially handled by the Worker, then passed to a container-enabled [Durable Object](https://developers.cloudflare.com/durable-objects). To simplify and reduce boilerplate code, Cloudflare provides a [`Container` class](https://github.com/cloudflare/containers) as part of the `@cloudflare/containers` NPM package.

You don't have to be familiar with Durable Objects to use Containers, but it may be helpful to understand the basics.

Each Durable Object runs alongside an individual container instance, manages starting and stopping it, and can interact with the container through its ports. Containers will likely run near the Worker instance requesting them, but not necessarily. Refer to ["How Locations are Selected"](https://developers.cloudflare.com/containers/platform-details/#how-are-locations-are-selected) for details.

In a simple app, the Durable Object may just boot the container and proxy requests to it.

In a more complex app, having container-enabled Durable Objects allows you to route requests to individual stateful container instances, manage the container lifecycle, pass in custom starting commands and environment variables to containers, run hooks on container status changes, and more.

See the [documentation for Durable Object container methods](https://developers.cloudflare.com/durable-objects/api/container/) and the [`Container` class repository](https://github.com/cloudflare/containers) for more details.

### Configuration

Your [Wrangler configuration file](https://developers.cloudflare.com/workers/wrangler/configuration/) defines the configuration for both your Worker and your container:

* wrangler.jsonc

  ```jsonc
  {
    "$schema": "./node_modules/wrangler/config-schema.json",
    "containers": [
      {
        "max_instances": 10,
        "class_name": "MyContainer",
        "image": "./Dockerfile"
      }
    ],
    "durable_objects": {
      "bindings": [
        {
          "name": "MY_CONTAINER",
          "class_name": "MyContainer"
        }
      ]
    },
    "migrations": [
      {
        "tag": "v1",
        "new_sqlite_classes": [
          "MyContainer"
        ]
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  [[containers]]
  max_instances = 10
  class_name = "MyContainer"
  image = "./Dockerfile"


  [[durable_objects.bindings]]
  name = "MY_CONTAINER"
  class_name = "MyContainer"


  [[migrations]]
  tag = "v1"
  new_sqlite_classes = ["MyContainer"]
  ```

Important points about this config:

* `image` points to a Dockerfile or to a directory containing a Dockerfile.
* `class_name` must be a [Durable Object class name](https://developers.cloudflare.com/durable-objects/api/base/).
* `max_instances` declares the maximum number of simultaneously running container instances that will run.
* The Durable Object must use [`new_sqlite_classes`](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#create-sqlite-backed-durable-object-class) not `new_classes`.

### The Container Image

Your container image must be able to run on the `linux/amd64` architecture, but aside from that, has few limitations.

In the example you just deployed, it is a simple Golang server that responds to requests on port 8080 using the `MESSAGE` environment variable that will be set in the Worker and an [auto-generated environment variable](https://developers.cloudflare.com/containers/platform-details/#environment-variables) `CLOUDFLARE_DEPLOYMENT_ID.`

```go
func handler(w http.ResponseWriter, r *http.Request) {
  message := os.Getenv("MESSAGE")
  instanceId := os.Getenv("CLOUDFLARE_DEPLOYMENT_ID")


  fmt.Fprintf(w, "Hi, I'm a container and this is my message: %s, and my instance ID is: %s", message, instanceId)
}
```

Note

After deploying the example code, to deploy a different image, you can replace the provided image with one of your own.

### Worker code

#### Container Configuration

First note `MyContainer` which extends the [`Container`](https://github.com/cloudflare/containers) class:

```js
export class MyContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '10s';
  envVars = {
    MESSAGE: 'I was passed in via the container class!',
  };


  override onStart() {
    console.log('Container successfully started');
  }


  override onStop() {
    console.log('Container successfully shut down');
  }


  override onError(error: unknown) {
    console.log('Container error:', error);
  }
}
```

This defines basic configuration for the container:

* `defaultPort` sets the port that the `fetch` and `containerFetch` methods will use to communicate with the container. It also blocks requests until the container is listening on this port.
* `sleepAfter` sets the timeout for the container to sleep after it has been idle for a certain amount of time.
* `envVars` sets environment variables that will be passed to the container when it starts.
* `onStart`, `onStop`, and `onError` are hooks that run when the container starts, stops, or errors, respectively.

See the [Container class documentation](https://developers.cloudflare.com/containers/container-package) for more details and configuration options.

#### Routing to Containers

When a request enters Cloudflare, your Worker's [`fetch` handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/) is invoked. This is the code that handles the incoming request. The fetch handler in the example code, launches containers in two ways, on different routes:

* Making requests to `/container/` passes requests to a new container for each path. This is done by spinning up a new Container instance. You may note that the first request to a new path takes longer than subsequent requests, this is because a new container is booting.

  ```js
  if (pathname.startsWith("/container")) {
    const container = env.MY_CONTAINER.getByName(pathname);
    return await container.fetch(request);
  }
  ```

* Making requests to `/lb` will load balance requests across several containers. This uses a simple `getRandom` helper method, which picks an ID at random from a set number (in this case 3), then routes to that Container instance. You can replace this with any routing or load balancing logic you choose to implement:

  ```js
  if (pathname.startsWith("/lb")) {
    const container = await getRandom(env.MY_CONTAINER, 3);
    return await container.fetch(request);
  }
  ```

This allows for multiple ways of using Containers:

* If you simply want to send requests to many stateless and interchangeable containers, you should load balance.
* If you have stateful services or need individually addressable containers, you should request specific Container instances.
* If you are running short-lived jobs, want fine-grained control over the container lifecycle, want to parameterize container entrypoint or env vars, or want to chain together multiple container calls, you should request specific Container instances.

Note

Currently, routing requests to one of many interchangeable Container instances is accomplished with the `getRandom` helper.

This is temporary — we plan to add native support for latency-aware autoscaling and load balancing in the coming months.

## View Containers in your Dashboard

The [Containers Dashboard](http://dash.cloudflare.com/?to=/:account/workers/containers) shows you helpful information about your Containers, including:

* Status and Health
* Metrics
* Logs
* A link to associated Workers and Durable Objects

After launching your Worker, navigate to the Containers Dashboard by clicking on "Containers" under "Workers & Pages" in your sidebar.

## Next Steps

To do more:

* Modify the image by changing the Dockerfile and calling `wrangler deploy`
* Review our [examples](https://developers.cloudflare.com/containers/examples) for more inspiration
* Get [more information on the Containers Beta](https://developers.cloudflare.com/containers/beta-info)

</page>

<page>
---
title: Local Development · Cloudflare Containers docs
description: You can run both your container and your Worker locally by simply
  running npx wrangler dev (or vite dev for Vite projects using the Cloudflare
  Vite plugin) in your project's directory.
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/local-dev/
  md: https://developers.cloudflare.com/containers/local-dev/index.md
---

You can run both your container and your Worker locally by simply running [`npx wrangler dev`](https://developers.cloudflare.com/workers/wrangler/commands/#dev) (or `vite dev` for Vite projects using the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)) in your project's directory.

To develop Container-enabled Workers locally, you will need to first ensure that a Docker compatible CLI tool and Engine are installed. For instance, you could use [Docker Desktop](https://docs.docker.com/desktop/) or [Colima](https://github.com/abiosoft/colima).

When you start a dev session, your container image will be built or downloaded. If your [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#containers) sets the `image` attribute to a local path, the image will be built using the local Dockerfile. If the `image` attribute is set to a URL, the image will be pulled from the Cloudflare registry.

Note

Currently, the Cloudflare Vite-plugin does not support registry links in local development, unlike `wrangler dev`. As a workaround, you can create a minimal Dockerfile that uses `FROM <registry-link>`. Make sure to `EXPOSE` a port for local dev as well.

Container instances will be launched locally when your Worker code calls to create a new container. Requests will then automatically be routed to the correct locally-running container.

When the dev session ends, all associated container instances should be stopped, but local images are not removed, so that they can be reused in subsequent builds.

Note

If your Worker app creates many container instances, your local machine may not be able to run as many containers concurrently as is possible when you deploy to Cloudflare.

Also, `max_instances` configuration option does not apply during local development.

Additionally, if you regularly rebuild containers locally, you may want to clear out old container images (using `docker image prune` or similar) to reduce disk used.

## Iterating on Container code

When you develop with Wrangler or Vite, your Worker's code is automatically reloaded each time you save a change, but code running within the container is not.

To rebuild your container with new code changes, you can hit the `[r]` key on your keyboard, which triggers a rebuild. Container instances will then be restarted with the newly built images.

You may prefer to set up your own code watchers and reloading mechanisms, or mount a local directory into the local container images to sync code changes. This can be done, but there is no built-in mechanism for doing so, and best-practices will depend on the languages and frameworks you are using in your container code.

## Troubleshooting

### Exposing Ports

In production, all of your container's ports will be accessible by your Worker, so you do not need to specifically expose ports using the [`EXPOSE` instruction](https://docs.docker.com/reference/dockerfile/#expose) in your Dockerfile.

But for local development you will need to declare any ports you need to access in your Dockerfile with the EXPOSE instruction; for example: `EXPOSE 4000`, if you will be accessing port 4000.

If you have not exposed any ports, you will see the following error in local development:

```txt
The container "MyContainer" does not expose any ports. In your Dockerfile, please expose any ports you intend to connect to.
```

And if you try to connect to any port that you have not exposed in your `Dockerfile` you will see the following error:

```txt
connect(): Connection refused: container port not found. Make sure you exposed the port in your container definition.
```

You may also see this while the container is starting up and no ports are available yet. You should retry until the ports become available. This retry logic should be handled for you if you are using the [containers package](https://github.com/cloudflare/containers/tree/main/src).

### Socket configuration - `internal error`

If you see an opaque `internal error` when attempting to connect to your container, you may need to set the `DOCKER_HOST` environment variable to the socket path your container engine is listening on. Wrangler or Vite will attempt to automatically find the correct socket to use to communicate with your container engine, but if that does not work, you may have to set this environment variable to the appropriate socket path.

</page>

<page>
---
title: Platform Reference · Cloudflare Containers docs
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: true
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/
  md: https://developers.cloudflare.com/containers/platform-details/index.md
---


</page>

<page>
---
title: Pricing · Cloudflare Containers docs
description: "Containers are billed for every 10ms that they are actively
  running at the following rates, with included monthly usage as part of the $5
  USD per month Workers Paid plan:"
lastUpdated: 2025-11-21T16:40:22.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/pricing/
  md: https://developers.cloudflare.com/containers/pricing/index.md
---

## vCPU, Memory and Disk

Containers are billed for every 10ms that they are actively running at the following rates, with included monthly usage as part of the $5 USD per month [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/):

| | Memory | CPU | Disk |
| - | - | - | - |
| **Free** | N/A | N/A | |
| **Workers Paid** | 25 GiB-hours/month included +$0.0000025 per additional GiB-second | 375 vCPU-minutes/month + $0.000020 per additional vCPU-second | 200 GB-hours/month +$0.00000007 per additional GB-second |

You only pay for what you use — charges start when a request is sent to the container or when it is manually started. Charges stop after the container instance goes to sleep, which can happen automatically after a timeout. This makes it easy to scale to zero, and allows you to get high utilization even with bursty traffic.

Memory and disk usage are based on the *provisioned resources* for the instance type you select, while CPU usage is based on *active usage* only.

#### Instance Types

When you deploy a container, you specify an [instance type](https://developers.cloudflare.com/containers/platform-details/#instance-types).

The instance type you select will impact your bill — larger instances include more memory and disk, incurring additional costs, and higher CPU capacity, which allows you to incur higher CPU costs based on active usage.

The following instance types are currently available:

| Instance Type | vCPU | Memory | Disk |
| - | - | - | - |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

## Network Egress

Egress from Containers is priced at the following rates:

| Region | Price per GB | Included Allotment per month |
| - | - | - |
| North America & Europe | $0.025 | 1 TB |
| Oceania, Korea, Taiwan | $0.05 | 500 GB |
| Everywhere Else | $0.04 | 500 GB |

## Workers and Durable Objects Pricing

When you use Containers, incoming requests to your containers are handled by your [Worker](https://developers.cloudflare.com/workers/platform/pricing/), and each container has its own [Durable Object](https://developers.cloudflare.com/durable-objects/platform/pricing/). You are billed for your usage of both Workers and Durable Objects.

## Logs and Observability

Containers are integrated with the [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) platform, and billed at the same rate. Refer to [Workers Logs pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing) for details.

When you [enable observability for your Worker](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#enable-workers-logs) with a binding to a container, logs from your container will show in both the Containers and Observability sections of the Cloudflare dashboard.

</page>

<page>
---
title: Wrangler Commands · Cloudflare Containers docs
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/wrangler-commands/
  md: https://developers.cloudflare.com/containers/wrangler-commands/index.md
---


</page>

<page>
---
title: Wrangler Configuration · Cloudflare Containers docs
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/wrangler-configuration/
  md: https://developers.cloudflare.com/containers/wrangler-configuration/index.md
---


</page>

<page>
---
title: Static Frontend, Container Backend · Cloudflare Containers docs
description: A simple frontend app with a containerized backend
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/container-backend/
  md: https://developers.cloudflare.com/containers/examples/container-backend/index.md
---

A common pattern is to serve a static frontend application (e.g., React, Vue, Svelte) using Static Assets, then pass backend requests to a containerized backend application.

In this example, we'll show an example using a simple `index.html` file served as a static asset, but you can select from one of many frontend frameworks. See our [Workers framework examples](https://developers.cloudflare.com/workers/framework-guides/web-apps/) for more information.

For a full example, see the [Static Frontend + Container Backend Template](https://github.com/mikenomitch/static-frontend-container-backend).

## Configure Static Assets and a Container

* wrangler.jsonc

  ```jsonc
  {
    "name": "cron-container",
    "main": "src/index.ts",
    "assets": {
      "directory": "./dist",
      "binding": "ASSETS"
    },
    "containers": [
      {
        "class_name": "Backend",
        "image": "./Dockerfile",
        "max_instances": 3
      }
    ],
    "durable_objects": {
      "bindings": [
        {
          "class_name": "Backend",
          "name": "BACKEND"
        }
      ]
    },
    "migrations": [
      {
        "new_sqlite_classes": [
          "Backend"
        ],
        "tag": "v1"
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  name = "cron-container"
  main = "src/index.ts"


  [assets]
  directory = "./dist"
  binding = "ASSETS"


  [[containers]]
  class_name = "Backend"
  image = "./Dockerfile"
  max_instances = 3


  [[durable_objects.bindings]]
  class_name = "Backend"
  name = "BACKEND"


  [[migrations]]
  new_sqlite_classes = [ "Backend" ]
  tag = "v1"
  ```

## Add a simple index.html file to serve

Create a simple `index.html` file in the `./dist` directory.

index.html

```html
<!DOCTYPE html>
<html lang="en">


<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Widgets</title>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.13.3/cdn.min.js"></script>
</head>


<body>
  <div x-data="widgets()" x-init="fetchWidgets()">
    <h1>Widgets</h1>
    <div x-show="loading">Loading...</div>
    <div x-show="error" x-text="error" style="color: red;"></div>
    <ul x-show="!loading && !error">
      <template x-for="widget in widgets" :key="widget.id">
        <li>
          <span x-text="widget.name"></span> - (ID: <span x-text="widget.id"></span>)
        </li>
      </template>
    </ul>


    <div x-show="!loading && !error && widgets.length === 0">
      No widgets found.
    </div>


  </div>


  <script>
    function widgets() {
      return {
        widgets: [],
        loading: false,
        error: null,


        async fetchWidgets() {
          this.loading = true;
          this.error = null;


          try {
            const response = await fetch('/api/widgets');
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            this.widgets = await response.json();
          } catch (err) {
            this.error = err.message;
          } finally {
            this.loading = false;
          }
        }
      }
    }
  </script>


</body>


</html>
```

In this example, we are using [Alpine.js](https://alpinejs.dev/) to fetch a list of widgets from `/api/widgets`.

This is meant to be a very simple example, but you can get significantly more complex. See [examples of Workers integrating with frontend frameworks](https://developers.cloudflare.com/workers/framework-guides/web-apps/) for more information.

## Define a Worker

Your Worker needs to be able to both serve static assets and route requests to the containerized backend.

In this case, we will pass requests to one of three container instances if the route starts with `/api`, and all other requests will be served as static assets.

```javascript
import { Container, getRandom } from "@cloudflare/containers";


const INSTANCE_COUNT = 3;


class Backend extends Container {
  defaultPort = 8080; // pass requests to port 8080 in the container
  sleepAfter = "2h"; // only sleep a container if it hasn't gotten requests in 2 hours
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) {
      // note: "getRandom" to be replaced with latency-aware routing in the near future
      const containerInstance = await getRandom(env.BACKEND, INSTANCE_COUNT);
      return containerInstance.fetch(request);
    }


    return env.ASSETS.fetch(request);
  },
};
```

Note

This example uses the `getRandom` function, which is a temporary helper that will randomly select of of N instances of a Container to route requests to.

In the future, we will provide improved latency-aware load balancing and autoscaling.

This will make scaling stateless instances simple and routing more efficient. See the [autoscaling documentation](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing) for more details.

## Define a backend container

Your container should be able to handle requests to `/api/widgets`.

In this case, we'll use a simple Golang backend that returns a hard-coded list of widgets.

server.go

```go
package main


import (
  "encoding/json"
  "log"
  "net/http"
)


func handler(w http.ResponseWriter, r \*http.Request) {
  widgets := []map[string]interface{}{
    {"id": 1, "name": "Widget A"},
    {"id": 2, "name": "Sprocket B"},
    {"id": 3, "name": "Gear C"},
  }


  w.Header().Set("Content-Type", "application/json")
  w.Header().Set("Access-Control-Allow-Origin", "*")
  json.NewEncoder(w).Encode(widgets)


}


func main() {
  http.HandleFunc("/api/widgets", handler)
  log.Fatal(http.ListenAndServe(":8080", nil))
}
```

</page>

<page>
---
title: Cron Container · Cloudflare Containers docs
description: Running a container on a schedule using Cron Triggers
lastUpdated: 2025-11-24T12:16:10.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/cron/
  md: https://developers.cloudflare.com/containers/examples/cron/index.md
---

To launch a container on a schedule, you can use a Workers [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

For a full example, see the [Cron Container Template](https://github.com/mikenomitch/cron-container/tree/main).

Use a cron expression in your Wrangler config to specify the schedule:

* wrangler.jsonc

  ```jsonc
  {
    "name": "cron-container",
    "main": "src/index.ts",
    "triggers": {
      "crons": [
        "*/2 * * * *" // Run every 2 minutes
      ]
    },
    "containers": [
      {
        "class_name": "CronContainer",
        "image": "./Dockerfile"
      }
    ],
    "durable_objects": {
      "bindings": [
        {
          "class_name": "CronContainer",
          "name": "CRON_CONTAINER"
        }
      ]
    },
    "migrations": [
      {
        "new_sqlite_classes": ["CronContainer"],
        "tag": "v1"
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  name = "cron-container"
  main = "src/index.ts"


  [triggers]
  crons = [ "*/2 * * * *" ]


  [[containers]]
  class_name = "CronContainer"
  image = "./Dockerfile"


  [[durable_objects.bindings]]
  class_name = "CronContainer"
  name = "CRON_CONTAINER"


  [[migrations]]
  new_sqlite_classes = [ "CronContainer" ]
  tag = "v1"
  ```

Then in your Worker, call your Container from the "scheduled" handler:

```ts
import { Container, getContainer } from '@cloudflare/containers';


export class CronContainer extends Container {
  sleepAfter = '10s';


  override onStart() {
    console.log('Starting container');
  }


  override onStop() {
    console.log('Container stopped');
  }
}


export default {
  async fetch(): Promise<Response> {
    return new Response("This Worker runs a cron job to execute a container on a schedule.");
  },


  async scheduled(_controller: any, env: { CRON_CONTAINER: DurableObjectNamespace<CronContainer> }) {
    let container = getContainer(env.CRON_CONTAINER);
    await container.start({
      envVars: {
        MESSAGE: "Start Time: " + new Date().toISOString(),
      }
    })
  },
};
```

</page>

<page>
---
title: Using Durable Objects Directly · Cloudflare Containers docs
description: Various examples calling Containers directly from Durable Objects
lastUpdated: 2025-08-18T14:27:42.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/durable-object-interface/
  md: https://developers.cloudflare.com/containers/examples/durable-object-interface/index.md
---


</page>

<page>
---
title: Env Vars and Secrets · Cloudflare Containers docs
description: Pass in environment variables and secrets to your container
lastUpdated: 2025-09-24T21:18:25.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/
  md: https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/index.md
---

Environment variables can be passed into a Container using the `envVars` field in the [`Container`](https://developers.cloudflare.com/containers/container-package) class, or by setting manually when the Container starts.

Secrets can be passed into a Container by using [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) or the [Secret Store](https://developers.cloudflare.com/secrets-store/integrations/workers/), then passing them into the Container as environment variables.

KV values can be passed into a Container by using [Workers KV](https://developers.cloudflare.com/kv/), then reading the values and passing them into the Container as environment variables.

These examples show the various ways to pass in secrets, KV values, and environment variables. In each, we will be passing in:

* the variable `"ENV_VAR"` as a hard-coded environment variable
* the secret `"WORKER_SECRET"` as a secret from Worker Secrets
* the secret `"SECRET_STORE_SECRET"` as a secret from the Secret Store
* the value `"KV_VALUE"` as a value from Workers KV

In practice, you may just use one of the methods for storing secrets and data, but we will show all methods for completeness.

## Creating secrets and KV data

First, let's create the `"WORKER_SECRET"` secret in Worker Secrets:

* npm

  ```sh
  npx wrangler secret put WORKER_SECRET
  ```

* yarn

  ```sh
  yarn wrangler secret put WORKER_SECRET
  ```

* pnpm

  ```sh
  pnpm wrangler secret put WORKER_SECRET
  ```

Then, let's create a store called "demo" in the Secret Store, and add the `"SECRET_STORE_SECRET"` secret to it:

* npm

  ```sh
  npx wrangler secrets-store store create demo --remote
  ```

* yarn

  ```sh
  yarn wrangler secrets-store store create demo --remote
  ```

* pnpm

  ```sh
  pnpm wrangler secrets-store store create demo --remote
  ```

- npm

  ```sh
  npx wrangler secrets-store secret create demo --name SECRET_STORE_SECRET --scopes workers --remote
  ```

- yarn

  ```sh
  yarn wrangler secrets-store secret create demo --name SECRET_STORE_SECRET --scopes workers --remote
  ```

- pnpm

  ```sh
  pnpm wrangler secrets-store secret create demo --name SECRET_STORE_SECRET --scopes workers --remote
  ```

Next, let's create a KV namespace called `DEMO_KV` and add a key-value pair:

* npm

  ```sh
  npx wrangler kv namespace create DEMO_KV
  ```

* yarn

  ```sh
  yarn wrangler kv namespace create DEMO_KV
  ```

* pnpm

  ```sh
  pnpm wrangler kv namespace create DEMO_KV
  ```

- npm

  ```sh
  npx wrangler kv key put --binding DEMO_KV KV_VALUE 'Hello from KV!'
  ```

- yarn

  ```sh
  yarn wrangler kv key put --binding DEMO_KV KV_VALUE 'Hello from KV!'
  ```

- pnpm

  ```sh
  pnpm wrangler kv key put --binding DEMO_KV KV_VALUE 'Hello from KV!'
  ```

For full details on how to create secrets, see the [Workers Secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/) and the [Secret Store documentation](https://developers.cloudflare.com/secrets-store/integrations/workers/). For KV setup, see the [Workers KV documentation](https://developers.cloudflare.com/kv/).

## Adding bindings

Next, we need to add bindings to access our secrets, KV values, and environment variables in Wrangler configuration.

* wrangler.jsonc

  ```jsonc
  {
    "name": "my-container-worker",
    "vars": {
      "ENV_VAR": "my-env-var"
    },
    "secrets_store_secrets": [
      {
        "binding": "SECRET_STORE",
        "store_id": "demo",
        "secret_name": "SECRET_STORE_SECRET"
      }
    ],
    "kv_namespaces": [
      {
        "binding": "DEMO_KV",
        "id": "<your-kv-namespace-id>"
      }
    ]
    // rest of the configuration...
  }
  ```

* wrangler.toml

  ```toml
  name = "my-container-worker"


  [vars]
  ENV_VAR = "my-env-var"


  [[secrets_store_secrets]]
  binding = "SECRET_STORE"
  store_id = "demo"
  secret_name = "SECRET_STORE_SECRET"


  [[kv_namespaces]]
  binding = "DEMO_KV"
  id = "<your-kv-namespace-id>"
  ```

Note that `"WORKER_SECRET"` does not need to be specified in the Wrangler config file, as it is automatically added to `env`.

Also note that we did not configure anything specific for environment variables, secrets, or KV values in the *container-related* portion of the Wrangler configuration file.

## Using `envVars` on the Container class

Now, let's pass the env vars and secrets to our container using the `envVars` field in the `Container` class:

```js
// https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global
import { env } from "cloudflare:workers";
export class MyContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10s";
  envVars = {
    WORKER_SECRET: env.WORKER_SECRET,
    ENV_VAR: env.ENV_VAR,
    // we can't set the secret store binding or KV values as defaults here, as getting their values is asynchronous
  };
}
```

Every instance of this `Container` will now have these variables and secrets set as environment variables when it launches.

## Setting environment variables per-instance

But what if you want to set environment variables on a per-instance basis?

In this case, use the `startAndWaitForPorts()` method to pass in environment variables for each instance.

```js
export class MyContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10s";
}


export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/launch-instances") {
      let instanceOne = env.MY_CONTAINER.getByName("foo");
      let instanceTwo = env.MY_CONTAINER.getByName("bar");


      // Each instance gets a different set of environment variables


      await instanceOne.startAndWaitForPorts({
        startOptions: {
          envVars: {
            ENV_VAR: env.ENV_VAR + "foo",
            WORKER_SECRET: env.WORKER_SECRET,
            SECRET_STORE_SECRET: await env.SECRET_STORE.get(),
            KV_VALUE: await env.DEMO_KV.get("KV_VALUE"),
          },
        },
      });


      await instanceTwo.startAndWaitForPorts({
        startOptions: {
          envVars: {
            ENV_VAR: env.ENV_VAR + "bar",
            WORKER_SECRET: env.WORKER_SECRET,
            SECRET_STORE_SECRET: await env.SECRET_STORE.get(),
            KV_VALUE: await env.DEMO_KV.get("KV_VALUE"),
            // You can also read different KV keys for different instances
            INSTANCE_CONFIG: await env.DEMO_KV.get("instance-bar-config"),
          },
        },
      });
      return new Response("Container instances launched");
    }


    // ... etc ...
  },
};
```

## Reading KV values in containers

KV values are particularly useful for configuration data that changes infrequently but needs to be accessible to your containers. Since KV operations are asynchronous, you must read the values at runtime when starting containers.

Here are common patterns for using KV with containers:

### Configuration data

```js
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/configure-container") {
      // Read configuration from KV
      const config = await env.DEMO_KV.get("container-config", "json");
      const apiUrl = await env.DEMO_KV.get("api-endpoint");


      let container = env.MY_CONTAINER.getByName("configured");


      await container.startAndWaitForPorts({
        startOptions: {
          envVars: {
            CONFIG_JSON: JSON.stringify(config),
            API_ENDPOINT: apiUrl,
            DEPLOYMENT_ENV: await env.DEMO_KV.get("deployment-env"),
          },
        },
      });


      return new Response("Container configured and launched");
    }
  },
};
```

### Feature flags

```js
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/launch-with-features") {
      // Read feature flags from KV
      const featureFlags = {
        ENABLE_FEATURE_A: await env.DEMO_KV.get("feature-a-enabled"),
        ENABLE_FEATURE_B: await env.DEMO_KV.get("feature-b-enabled"),
        DEBUG_MODE: await env.DEMO_KV.get("debug-enabled"),
      };


      let container = env.MY_CONTAINER.getByName("features");


      await container.startAndWaitForPorts({
        startOptions: {
          envVars: {
            ...featureFlags,
            CONTAINER_VERSION: "1.2.3",
          },
        },
      });


      return new Response("Container launched with feature flags");
    }
  },
};
```

## Build-time environment variables

Finally, you can also set build-time environment variables that are only available when building the container image via the `image_vars` field in the Wrangler configuration.

</page>

<page>
---
title: Mount R2 buckets with FUSE · Cloudflare Containers docs
description: Mount R2 buckets as filesystems using FUSE in Containers
lastUpdated: 2025-12-10T16:39:46.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/r2-fuse-mount/
  md: https://developers.cloudflare.com/containers/examples/r2-fuse-mount/index.md
---

FUSE (Filesystem in Userspace) allows you to mount [R2 buckets](https://developers.cloudflare.com/r2/) as filesystems within Containers. Applications can then interact with R2 using standard filesystem operations rather than object storage APIs.

Common use cases include:

* **Bootstrapping containers with assets** - Mount datasets, models, or dependencies for sandboxes and agent environments
* **Persisting user state** - Store and access user configuration or application state without managing downloads
* **Large static files** - Avoid bloating container images or downloading files at startup
* **Editing files** - Make code or config available within the container and save edits across instances.

Performance considerations

Object storage is not a POSIX-compatible filesystem, nor is it local storage. While FUSE mounts provide a familiar interface, you should not expect native SSD-like performance.

Common use cases where this tradeoff is acceptable include reading shared assets, bootstrapping [agents](https://developers.cloudflare.com/agents/) or [sandboxes](https://developers.cloudflare.com/sandbox/) with initial data, persisting user state, and applications that require filesystem APIs but don't need high-performance I/O.

## Mounting buckets

To mount an R2 bucket, install a FUSE adapter in your Dockerfile and configure it to run at container startup.

This example uses [tigrisfs](https://github.com/tigrisdata/tigrisfs), which supports S3-compatible storage including R2:

Dockerfile

```dockerfile
FROM alpine:3.20


# Install FUSE and dependencies
RUN apk add --no-cache \
    --repository http://dl-cdn.alpinelinux.org/alpine/v3.20/main \
    ca-certificates fuse curl bash


# Install tigrisfs
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    VERSION=$(curl -s https://api.github.com/repos/tigrisdata/tigrisfs/releases/latest | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4) && \
    curl -L "https://github.com/tigrisdata/tigrisfs/releases/download/${VERSION}/tigrisfs_${VERSION#v}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz && \
    tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && \
    rm /tmp/tigrisfs.tar.gz && \
    chmod +x /usr/local/bin/tigrisfs


# Create startup script that mounts bucket and runs a command
RUN printf '#!/bin/sh\n\
    set -e\n\
    \n\
    mkdir -p /mnt/r2\n\
    \n\
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"\n\
    echo "Mounting bucket ${R2_BUCKET_NAME}..."\n\
    /usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -f "${R2_BUCKET_NAME}" /mnt/r2 &\n\
    sleep 3\n\
    \n\
    echo "Contents of mounted bucket:"\n\
    ls -lah /mnt/r2\n\
    ' > /startup.sh && chmod +x /startup.sh


EXPOSE 8080
CMD ["/startup.sh"]
```

The startup script creates a mount point, starts tigrisfs in the background to mount the bucket, and then lists the mounted directory contents.

### Passing credentials to the container

Your Container needs [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/) and configuration passed as environment variables. Store credentials as [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), then pass them through the `envVars` property:

* JavaScript

  ```js
  import { Container, getContainer } from "@cloudflare/containers";


  export class FUSEDemo extends Container {
    defaultPort = 8080;
    sleepAfter = "10m";
    envVars = {
      AWS_ACCESS_KEY_ID: this.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: this.env.AWS_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    };
  }
  ```

* TypeScript

  ```ts
  import { Container, getContainer } from "@cloudflare/containers";


  interface Env {
    FUSEDemo: DurableObjectNamespace<FUSEDemo>;
    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    R2_BUCKET_NAME: string;
    R2_ACCOUNT_ID: string;
  }


  export class FUSEDemo extends Container<Env> {
    defaultPort = 8080;
    sleepAfter = "10m";
    envVars = {
      AWS_ACCESS_KEY_ID: this.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: this.env.AWS_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    };
  }
  ```

The `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` should be stored as secrets, while `R2_BUCKET_NAME` and `R2_ACCOUNT_ID` can be configured as variables in your `wrangler.jsonc`:

Creating your R2 AWS API keys

To get your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, [head to your R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2/overview) and create a new R2 Access API key. Use the generated the `Access Key ID` as your `AWS_ACCESS_KEY_ID` and `Secret Access Key` is the `AWS_SECRET_ACCESS_KEY`.

```json
{
  "vars": {
    "R2_BUCKET_NAME": "my-bucket",
    "R2_ACCOUNT_ID": "your-account-id"
  }
}
```

### Other S3-compatible storage providers

Other S3-compatible storage providers, including AWS S3 and Google Cloud Storage, can be mounted using the same approach as R2. You will need to provide the appropriate endpoint URL and access credentials for the storage provider.

## Mounting bucket prefixes

To mount a specific prefix (subdirectory) within a bucket, most FUSE adapters require mounting the entire bucket and then accessing the prefix path within the mount.

With tigrisfs, mount the bucket and access the prefix via the filesystem path:

```dockerfile
RUN printf '#!/bin/sh\n\
    set -e\n\
    \n\
    mkdir -p /mnt/r2\n\
    \n\
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"\n\
    /usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -f "${R2_BUCKET_NAME}" /mnt/r2 &\n\
    sleep 3\n\
    \n\
    echo "Accessing prefix: ${BUCKET_PREFIX}"\n\
    ls -lah "/mnt/r2/${BUCKET_PREFIX}"\n\
    ' > /startup.sh && chmod +x /startup.sh
```

Your application can then read from `/mnt/r2/${BUCKET_PREFIX}` to access only the files under that prefix. Pass `BUCKET_PREFIX` as an environment variable alongside your other R2 configuration.

## Mounting buckets as read-only

To prevent applications from writing to the mounted bucket, add the `-o ro` flag to mount the filesystem as read-only:

```dockerfile
RUN printf '#!/bin/sh\n\
    set -e\n\
    \n\
    mkdir -p /mnt/r2\n\
    \n\
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"\n\
    /usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -o ro -f "${R2_BUCKET_NAME}" /mnt/r2 &\n\
    sleep 3\n\
    \n\
    ls -lah /mnt/r2\n\
    ' > /startup.sh && chmod +x /startup.sh
```

This is useful for shared assets or configuration files where you want to ensure applications only read data.

## Related resources

* [Container environment variables](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/) - Learn how to pass secrets and variables to Containers
* [tigrisfs](https://github.com/tigrisdata/tigrisfs) - FUSE adapter for S3-compatible storage including R2
* [s3fs](https://github.com/s3fs-fuse/s3fs-fuse) - Alternative FUSE adapter for S3-compatible storage
* [gcsfuse](https://github.com/GoogleCloudPlatform/gcsfuse) - FUSE adapter for Google Cloud Storage buckets

</page>

<page>
---
title: Stateless Instances · Cloudflare Containers docs
description: Run multiple instances across Cloudflare's network
lastUpdated: 2025-11-20T16:12:21.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/stateless/
  md: https://developers.cloudflare.com/containers/examples/stateless/index.md
---

To simply proxy requests to one of multiple instances of a container, you can use the `getRandom` function:

```ts
import { Container, getRandom } from "@cloudflare/containers";


const INSTANCE_COUNT = 3;


class Backend extends Container {
  defaultPort = 8080;
  sleepAfter = "2h";
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // note: "getRandom" to be replaced with latency-aware routing in the near future
    const containerInstance = await getRandom(env.BACKEND, INSTANCE_COUNT);
    return containerInstance.fetch(request);
  },
};
```

Note

This example uses the `getRandom` function, which is a temporary helper that will randomly select one of N instances of a Container to route requests to.

In the future, we will provide improved latency-aware load balancing and autoscaling.

This will make scaling stateless instances simple and routing more efficient. See the [autoscaling documentation](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing) for more details.

</page>

<page>
---
title: Status Hooks · Cloudflare Containers docs
description: Execute Workers code in reaction to Container status changes
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/status-hooks/
  md: https://developers.cloudflare.com/containers/examples/status-hooks/index.md
---

When a Container starts, stops, and errors, it can trigger code execution in a Worker that has defined status hooks on the `Container` class. Refer to the [Container package docs](https://github.com/cloudflare/containers/blob/main/README.md#lifecycle-hooks) for more details.

```js
import { Container } from '@cloudflare/containers';


export class MyContainer extends Container {
  defaultPort = 4000;
  sleepAfter = '5m';


  override onStart() {
    console.log('Container successfully started');
  }


  override onStop(stopParams) {
    if (stopParams.exitCode === 0) {
      console.log('Container stopped gracefully');
    } else {
      console.log('Container stopped with exit code:', stopParams.exitCode);
    }


    console.log('Container stop reason:', stopParams.reason);
  }


  override onError(error: string) {
    console.log('Container error:', error);
  }
}
```

</page>

<page>
---
title: Websocket to Container · Cloudflare Containers docs
description: Forwarding a Websocket request to a Container
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/examples/websocket/
  md: https://developers.cloudflare.com/containers/examples/websocket/index.md
---

WebSocket requests are automatically forwarded to a container using the default `fetch` method on the `Container` class:

```js
import { Container, getContainer } from "@cloudflare/containers";


export class MyContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
}


export default {
  async fetch(request, env) {
    // gets default instance and forwards websocket from outside Worker
    return getContainer(env.MY_CONTAINER).fetch(request);
  },
};
```

View a full example in the [Container class repository](https://github.com/cloudflare/containers/tree/main/examples/websocket).

</page>

<page>
---
title: Lifecycle of a Container · Cloudflare Containers docs
description: >-
  After you deploy an application with a Container, your image is uploaded to

  Cloudflare's Registry and distributed globally to Cloudflare's Network.

  Cloudflare will pre-schedule instances and pre-fetch images across the globe
  to ensure quick start

  times when scaling up the number of concurrent container instances.
lastUpdated: 2025-10-10T20:42:18.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/architecture/
  md: https://developers.cloudflare.com/containers/platform-details/architecture/index.md
---

## Deployment

After you deploy an application with a Container, your image is uploaded to [Cloudflare's Registry](https://developers.cloudflare.com/containers/platform-details/image-management) and distributed globally to Cloudflare's Network. Cloudflare will pre-schedule instances and pre-fetch images across the globe to ensure quick start times when scaling up the number of concurrent container instances.

Unlike Workers, which are updated immediately on deploy, container instances are updated using a rolling deploy strategy. This allows you to gracefully shutdown any running instances during a rollout. Refer to [rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/) for more details.

## Lifecycle of a Request

### Client to Worker

Recall that Containers are backed by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [Workers](https://developers.cloudflare.com/workers/). Requests are first routed through a Worker, which is generally handled by a datacenter in a location with the best latency between itself and the requesting user. A different datacenter may be selected to optimize overall latency, if [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/) is on, or if the nearest location is under heavy load.

Because all Container requests are passed through a Worker, end-users cannot make non-HTTP TCP or UDP requests to a Container instance. If you have a use case that requires inbound TCP or UDP from an end-user, please [let us know](https://forms.gle/AGSq54VvUje6kmKu8).

### Worker to Durable Object

From the Worker, a request passes through a Durable Object instance (the [Container package](https://developers.cloudflare.com/containers/container-package) extends a Durable Object class). Each Durable Object instance is a globally routable isolate that can execute code and store state. This allows developers to easily address and route to specific container instances (no matter where they are placed), define and run hooks on container status changes, execute recurring checks on the instance, and store persistent state associated with each instance.

### Starting a Container

When a Durable Object instance requests to start a new container instance, the **nearest location with a pre-fetched image** is selected.

Note

Currently, Durable Objects may be co-located with their associated Container instance, but often are not.

Cloudflare is currently working on expanding the number of locations in which a Durable Object can run, which will allow container instances to always run in the same location as their Durable Object.

Starting additional container instances will use other locations with pre-fetched images, and Cloudflare will automatically begin prepping additional machines behind the scenes for additional scaling and quick cold starts. Because there are a finite number of pre-warmed locations, some container instances may be started in locations that are farther away from the end-user. This is done to ensure that the container instance starts quickly. You are only charged for actively running instances and not for any unused pre-warmed images.

#### Cold starts

A cold start is when a container instance is started from a completely stopped state. If you call `env.MY_CONTAINER.get(id)` with a completely novel ID and launch this instance for the first time, it will result in a cold start. This will start the container image from its entrypoint for the first time. Depending on what this entrypoint does, it will take a variable amount of time to start.

Container cold starts can often be the 2-3 second range, but this is dependent on image size and code execution time, among other factors.

### Requests to running Containers

When a request *starts* a new container instance, the nearest location with a pre-fetched image is selected. Subsequent requests to a particular instance, regardless of where they originate, will be routed to this location as long as the instance stays alive.

However, once that container instance stops and restarts, future requests could be routed to a *different* location. This location will again be the nearest location to the originating request with a pre-fetched image.

### Container runtime

Each container instance runs inside its own VM, which provides strong isolation from other workloads running on Cloudflare's network. Containers should be built for the `linux/amd64` architecture, and should stay within [size limits](https://developers.cloudflare.com/containers/platform-details/limits).

[Logging](https://developers.cloudflare.com/containers/faq/#how-do-container-logs-work), metrics collection, and [networking](https://developers.cloudflare.com/containers/faq/#how-do-i-allow-or-disallow-egress-from-my-container) are automatically set up on each container, as configured by the developer.

### Container shutdown

If you do not set [`sleepAfter`](https://github.com/cloudflare/containers/blob/main/README.md#properties) on your Container class, or stop the instance manually, the container will shut down soon after the container stops receiving requests. By setting `sleepAfter`, the container will stay alive for approximately the specified duration.

You can manually shutdown a container instance by calling `stop()` or `destroy()` on it - refer to the [Container package docs](https://github.com/cloudflare/containers/blob/main/README.md#container-methods) for more details.

When a container instance is going to be shut down, it is sent a `SIGTERM` signal, and then a `SIGKILL` signal after 15 minutes. You should perform any necessary cleanup to ensure a graceful shutdown in this time.

#### Persistent disk

All disk is ephemeral. When a Container instance goes to sleep, the next time it is started, it will have a fresh disk as defined by its container image. Persistent disk is something the Cloudflare team is exploring in the future, but is not slated for the near term.

## An example request

* A developer deploys a Container. Cloudflare automatically readies instances across its Network.
* A request is made from a client in Bariloche, Argentina. It reaches the Worker in a nearby Cloudflare location in Neuquen, Argentina.
* This Worker request calls `getContainer(env.MY_CONTAINER, "session-1337")`. Under the hood, this brings up a Durable Object, which then calls `this.ctx.container.start`.
* This requests the nearest free Container instance. Cloudflare recognizes that an instance is free in Buenos Aires, Argentina, and starts it there.
* A different user needs to route to the same container. This user's request reaches the Worker running in Cloudflare's location in San Diego, US.
* The Worker again calls `getContainer(env.MY_CONTAINER, "session-1337")`.
* If the initial container instance is still running, the request is routed to the original location in Buenos Aires. If the initial container has gone to sleep, Cloudflare will once again try to find the nearest "free" instance of the Container, likely one in North America, and start an instance there.

</page>

<page>
---
title: Durable Object Interface · Cloudflare Containers docs
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/durable-object-methods/
  md: https://developers.cloudflare.com/containers/platform-details/durable-object-methods/index.md
---


</page>

<page>
---
title: Environment Variables · Cloudflare Containers docs
description: "The container runtime automatically sets the following variables:"
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/environment-variables/
  md: https://developers.cloudflare.com/containers/platform-details/environment-variables/index.md
---

## Runtime environment variables

The container runtime automatically sets the following variables:

* `CLOUDFLARE_APPLICATION_ID` - the ID of the Containers application
* `CLOUDFLARE_COUNTRY_A2` - the [ISO 3166-1 Alpha 2 code](https://www.iso.org/obp/ui/#search/code/) of a country the container is placed in
* `CLOUDFLARE_LOCATION` - a name of a location the container is placed in
* `CLOUDFLARE_REGION` - a region name
* `CLOUDFLARE_DURABLE_OBJECT_ID` - the ID of the Durable Object instance that the container is bound to. You can use this to identify particular container instances on the dashboard.

## User-defined environment variables

You can set environment variables when defining a Container in your Worker, or when starting a container instance.

For example:

```javascript
class MyContainer extends Container {
  defaultPort = 4000;
  envVars = {
    MY_CUSTOM_VAR: "value",
    ANOTHER_VAR: "another_value",
  };
}
```

More details about defining environment variables and secrets can be found in [this example](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets).

</page>

<page>
---
title: Image Management · Cloudflare Containers docs
description: >-
  When running wrangler deploy, if you set the image attribute in your Wrangler
  configuration to a path to a Dockerfile, Wrangler will build your container
  image locally using Docker, then push it to a registry run by Cloudflare.

  This registry is integrated with your Cloudflare account and is backed by R2.
  All authentication is handled automatically by

  Cloudflare both when pushing and pulling images.
lastUpdated: 2025-12-15T16:24:25.000Z
chatbotDeprioritize: true
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/image-management/
  md: https://developers.cloudflare.com/containers/platform-details/image-management/index.md
---

## Pushing images during `wrangler deploy`

When running `wrangler deploy`, if you set the `image` attribute in your [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#containers) to a path to a Dockerfile, Wrangler will build your container image locally using Docker, then push it to a registry run by Cloudflare. This registry is integrated with your Cloudflare account and is backed by [R2](https://developers.cloudflare.com/r2/). All authentication is handled automatically by Cloudflare both when pushing and pulling images.

Just provide the path to your Dockerfile:

* wrangler.jsonc

  ```jsonc
  {
    "containers": {
      "image": "./Dockerfile"
      // ...rest of config...
    }
  }
  ```

* wrangler.toml

  ```toml
  [containers]
  image = "./Dockerfile"
  ```

And deploy your Worker with `wrangler deploy`. No other image management is necessary.

On subsequent deploys, Wrangler will only push image layers that have changed, which saves space and time.

Note

Docker or a Docker-compatible CLI tool must be running for Wrangler to build and push images. This is not necessary if you are using a pre-built image, as described below.

## Using pre-built container images

Currently, we support images stored in the Cloudflare managed registry at `registry.cloudflare.com` and in [Amazon ECR](https://aws.amazon.com/ecr/). Support for additional external registries is coming soon.

If you wish to use a pre-built image from another registry provider, first, make sure it exists locally, then push it to the Cloudflare Registry:

```plaintext
docker pull <public-image>
docker tag <public-image> <image>:<tag>
```

Wrangler provides a command to push images to the Cloudflare Registry:

* npm

  ```sh
  npx wrangler containers push <image>:<tag>
  ```

* yarn

  ```sh
  yarn wrangler containers push <image>:<tag>
  ```

* pnpm

  ```sh
  pnpm wrangler containers push <image>:<tag>
  ```

Or, you can use the `-p` flag with `wrangler containers build` to build and push an image in one step:

* npm

  ```sh
  npx wrangler containers build -p -t <tag> .
  ```

* yarn

  ```sh
  yarn wrangler containers build -p -t <tag> .
  ```

* pnpm

  ```sh
  pnpm wrangler containers build -p -t <tag> .
  ```

This will output an image registry URI that you can then use in your Wrangler configuration:

* wrangler.jsonc

  ```jsonc
  {
    "containers": {
      "image": "registry.cloudflare.com/your-account-id/your-image:tag"
      // ...rest of config...
    }
  }
  ```

* wrangler.toml

  ```toml
  [containers]
  image = "registry.cloudflare.com/your-account-id/your-image:tag"
  ```

### Using Amazon ECR container images

To use container images stored in [Amazon ECR](https://aws.amazon.com/ecr/), you will need to configure the ECR registry domain with credentials. These credentials get stored in [Secrets Store](https://developers.cloudflare.com/secrets-store) under the `containers` scope. When we prepare your container, these credentials will be used to generate an ephemeral token that can pull your image. We do not currently support public ECR images. To generate the necessary credentials for ECR, you will need to create an IAM user with a read-only policy. The following example grants access to all image repositories under AWS account `123456789012` in `us-east-1`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": ["ecr:GetAuthorizationToken"],
      "Effect": "Allow",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      // arn:${Partition}:ecr:${Region}:${Account}:repository/${Repository-name}
      "Resource": [
        "arn:aws:ecr:us-east-1:123456789012:repository/*"
        // "arn:aws:ecr:us-east-1:123456789012:repository/example-repo"
      ]
    }
  ]
}
```

You can then use the credentials for the IAM User to [configure a registry in Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/#containers-registries). Wrangler will prompt you to create a Secrets Store store if one does not already exist, and then create your secret.

* npm

  ```sh
  npx wrangler containers registries configure 123456789012.dkr.ecr.us-east-1.amazonaws.com --aws-access-key-id=AKIAIOSFODNN7EXAMPLE
  ```

* yarn

  ```sh
  yarn wrangler containers registries configure 123456789012.dkr.ecr.us-east-1.amazonaws.com --aws-access-key-id=AKIAIOSFODNN7EXAMPLE
  ```

* pnpm

  ```sh
  pnpm wrangler containers registries configure 123456789012.dkr.ecr.us-east-1.amazonaws.com --aws-access-key-id=AKIAIOSFODNN7EXAMPLE
  ```

Once this is setup, you will be able to use ECR images in your wrangler config.

* wrangler.jsonc

  ```jsonc
  {
    "containers": {
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/example-repo:tag"
      // ...rest of config...
    }
  }
  ```

* wrangler.toml

  ```toml
  [containers]
  image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/example-repo:tag"
  ```

Note

Currently, the Cloudflare Vite-plugin does not support registry links in local development, unlike `wrangler dev`. As a workaround, you can create a minimal Dockerfile that uses `FROM <registry-link>`. Make sure to `EXPOSE` a port in local dev as well.

## Pushing images with CI

To use an image built in a continuous integration environment, install `wrangler` then build and push images using either `wrangler containers build` with the `--push` flag, or using the `wrangler containers push` command.

## Registry Limits

Images are limited in size by available disk of the configured [instance type](https://developers.cloudflare.com/containers/platform-details/limits/#instance-types) for a Container.

Delete images with `wrangler containers images delete` to free up space, but reverting a Worker to a previous version that uses a deleted image will then error.

</page>

<page>
---
title: Limits and Instance Types · Cloudflare Containers docs
description: >-
  The memory, vCPU, and disk space for Containers are set through predefined
  instance types.

  Six instance types are currently available:
lastUpdated: 2025-10-07T17:35:44.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/limits/
  md: https://developers.cloudflare.com/containers/platform-details/limits/index.md
---

## Instance Types

The memory, vCPU, and disk space for Containers are set through predefined instance types. Six instance types are currently available:

| Instance Type | vCPU | Memory | Disk |
| - | - | - | - |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

These are specified using the [`instance_type` property](https://developers.cloudflare.com/workers/wrangler/configuration/#containers) in your Worker's Wrangler configuration file. Looking for larger instances? [Give us feedback here](https://developers.cloudflare.com/containers/beta-info/#feedback-wanted) and tell us what size instances you need, and what you want to use them for.

Note

The `dev` and `standard` instance types are preserved for backward compatibility and are aliases for `lite` and `standard-1`, respectively.

## Limits

While in open beta, the following limits are currently in effect:

| Feature | Workers Paid |
| - | - |
| GiB Memory for all concurrent live Container instances | 400GiB |
| vCPU for all concurrent live Container instances | 100 |
| TB Disk for all concurrent live Container instances | 2TB |
| Image size | Same as [instance disk space](#instance-types) |
| Total image storage per account | 50 GB [1](#user-content-fn-1) |

## Footnotes

1. Delete container images with `wrangler containers delete` to free up space. Note that if you delete a container image and then [roll back](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) your Worker to a previous version, this version may no longer work. [↩](#user-content-fnref-1)

</page>

<page>
---
title: Rollouts · Cloudflare Containers docs
description: >-
  When you run wrangler deploy, the Worker code is updated immediately and
  Container

  instances are updated using a rolling deploy strategy. The default rollout
  configuration is two steps,

  where the first step updates 10% of the instances, and the second step updates
  the remaining 90%.

  This can be configured in your Wrangler config file using the
  rollout_step_percentage property.
lastUpdated: 2025-11-26T14:23:54.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/rollouts/
  md: https://developers.cloudflare.com/containers/platform-details/rollouts/index.md
---

## How rollouts work

When you run `wrangler deploy`, the Worker code is updated immediately and Container instances are updated using a rolling deploy strategy. The default rollout configuration is two steps, where the first step updates 10% of the instances, and the second step updates the remaining 90%. This can be configured in your Wrangler config file using the [`rollout_step_percentage`](https://developers.cloudflare.com/workers/wrangler/configuration#containers) property.

When deploying a change, you can also configure a [`rollout_active_grace_period`](https://developers.cloudflare.com/workers/wrangler/configuration#containers), which is the minimum number of seconds to wait before an active container instance becomes eligible for updating during a rollout. At that point, the container will be sent at `SIGTERM`, and still has 15 minutes to shut down gracefully. If the instance does not stop within 15 minutes, it is forcefully stopped with a `SIGKILL` signal. If you have cleanup that must occur before a Container instance is stopped, you should do it during this 15 minute period.

Once stopped, the instance is replaced with a new instance running the updated code. Requests may hang while the container is starting up again.

Here is an example configuration that sets a 5 minute grace period and a two step rollout where the first step updates 10% of instances and the second step updates 100% of instances:

* wrangler.jsonc

  ```jsonc
  {
    "$schema": "./node_modules/wrangler/config-schema.json",
    "containers": [
      {
        "max_instances": 10,
        "class_name": "MyContainer",
        "image": "./Dockerfile",
        "rollout_active_grace_period": 300,
        "rollout_step_percentage": [
          10,
          100
        ]
      }
    ],
    "durable_objects": {
      "bindings": [
        {
          "name": "MY_CONTAINER",
          "class_name": "MyContainer"
        }
      ]
    },
    "migrations": [
      {
        "tag": "v1",
        "new_sqlite_classes": [
          "MyContainer"
        ]
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  [[containers]]
  max_instances = 10
  class_name = "MyContainer"
  image = "./Dockerfile"
  rollout_active_grace_period = 300
  rollout_step_percentage = [10, 100]


  [[durable_objects.bindings]]
  name = "MY_CONTAINER"
  class_name = "MyContainer"


  [[migrations]]
  tag = "v1"
  new_sqlite_classes = ["MyContainer"]
  ```

## Immediate rollouts

If you need to do a one-off deployment that rolls out to 100% of container instances in one step, you can deploy with:

* npm

  ```sh
  npx wrangler deploy --containers-rollout=immediate
  ```

* yarn

  ```sh
  yarn wrangler deploy --containers-rollout=immediate
  ```

* pnpm

  ```sh
  pnpm wrangler deploy --containers-rollout=immediate
  ```

Note that `rollout_active_grace_period`, if configured, will still apply.

</page>

<page>
---
title: Scaling and Routing · Cloudflare Containers docs
description: >-
  Currently, Containers are only scaled manually by getting containers with a
  unique ID, then

  starting the container. Note that that getting a container does not
  automatically start it.
lastUpdated: 2025-09-22T15:52:17.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/
  md: https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/index.md
---

### Scaling container instances with `get()`

Note

This section uses helpers from the [Container package](https://developers.cloudflare.com/containers/container-package).

Currently, Containers are only scaled manually by getting containers with a unique ID, then starting the container. Note that that getting a container does not automatically start it.

```typescript
// get and start two container instances
const containerOne = getContainer(
  env.MY_CONTAINER,
  idOne,
).startAndWaitForPorts();


const containerTwo = getContainer(
  env.MY_CONTAINER,
  idTwo,
).startAndWaitForPorts();
```

Each instance will run until its `sleepAfter` time has elapsed, or until it is manually stopped.

This behavior is very useful when you want explicit control over the lifecycle of container instances. For instance, you may want to spin up a container backend instance for a specific user, or you may briefly run a code sandbox to isolate AI-generated code, or you may want to run a short-lived batch job.

#### The `getRandom` helper function

However, sometimes you want to run multiple instances of a container and easily route requests to them.

Currently, the best way to achieve this is with the *temporary* `getRandom` helper function:

```javascript
import { Container, getRandom } from "@cloudflare/containers";


const INSTANCE_COUNT = 3;


class Backend extends Container {
  defaultPort = 8080;
  sleepAfter = "2h";
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // note: "getRandom" to be replaced with latency-aware routing in the near future
    const containerInstance = getRandom(env.BACKEND, INSTANCE_COUNT)
    return containerInstance.fetch(request);
  },
};
```

We have provided the getRandom function as a stopgap solution to route to multiple stateless container instances. It will randomly select one of N instances for each request and route to it. Unfortunately, it has two major downsides:

* It requires that the user set a fixed number of instances to route to.
* It will randomly select each instance, regardless of location.

We plan to fix these issues with built-in autoscaling and routing features in the near future.

### Autoscaling and routing (unreleased)

Note

This is an unreleased feature. It is subject to change.

You will be able to turn autoscaling on for a Container, by setting the `autoscale` property to on the Container class:

```javascript
class MyBackend extends Container {
  autoscale = true;
  defaultPort = 8080;
}
```

This instructs the platform to automatically scale instances based on incoming traffic and resource usage (memory, CPU).

Container instances will be launched automatically to serve local traffic, and will be stopped when they are no longer needed.

To route requests to the correct instance, you will use the `getContainer()` helper function to get a container instance, then pass requests to it:

```javascript
export default {
  async fetch(request, env) {
    return getContainer(env.MY_BACKEND).fetch(request);
  },
};
```

This will send traffic to the nearest ready instance of a container. If a container is overloaded or has not yet launched, requests will be routed to potentially more distant container. Container readiness can be automatically determined based on resource use, but will also be configurable with custom readiness checks.

Autoscaling and latency-aware routing will be available in the near future, and will be documented in more detail when released. Until then, you can use the `getRandom` helper function to route requests to multiple container instances.

</page>
