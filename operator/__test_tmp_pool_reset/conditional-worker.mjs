
      let initCount = 0;
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          initCount++;
          process.send({ type: 'ready' });
          // Crash on first init only
          if (initCount === 1) {
            setTimeout(() => process.exit(1), 50);
          }
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        }
      });
    