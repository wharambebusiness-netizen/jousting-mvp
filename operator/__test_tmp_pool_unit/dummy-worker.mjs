
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        } else if (msg.type === 'start') {
          process.send({ type: 'event', event: 'orchestrator:started', data: { workerId: msg.workerId || process.env.WORKER_ID } });
        }
      });
    