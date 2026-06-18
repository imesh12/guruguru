import dgram from 'node:dgram';
import net from 'node:net';
import process from 'node:process';

const mode = process.env.SE220_RECEIVER_MODE === 'tcp' ? 'tcp' : 'udp';
const port = Number(process.env.SE220_RECEIVER_PORT ?? 5010);

const linesByVehicle: Record<string, string[]> = {
  'receiver:test-vehicle-1': [
    'receiver=test-vehicle-1;$GPRMC,092751.000,A,3540.8240,N,13946.1400,E,005.5,084.4,230394,,,A*6C',
    'receiver=test-vehicle-1;$GPGGA,092751.000,3540.8240,N,13946.1400,E,1,08,1.0,12.0,M,0.0,M,,*47',
  ],
  'receiver:test-vehicle-2': [
    'receiver=test-vehicle-2;$GNRMC,092752.000,A,3540.8960,N,13946.2720,E,004.2,142.1,230394,,,A*68',
    'receiver=test-vehicle-2;$GNGGA,092752.000,3540.8960,N,13946.2720,E,1,10,0.8,11.0,M,0.0,M,,*43',
  ],
};

const sendUdp = async () => {
  const socket = dgram.createSocket('udp4');

  for (const [sourceId, lines] of Object.entries(linesByVehicle)) {
    for (const line of lines) {
      await new Promise<void>((resolve, reject) => {
        socket.send(Buffer.from(`${line}\n`, 'utf8'), port, '127.0.0.1', (error) => {
          if (error) {
            reject(error);
            return;
          }

          console.log(`Sent UDP sample for ${sourceId}: ${line}`);
          resolve();
        });
      });
    }
  }

  socket.close();
};

const sendTcp = async () => {
  await Promise.all(
    Object.entries(linesByVehicle).map(
      ([sourceId, lines]) =>
        new Promise<void>((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
            socket.write(`${lines.join('\n')}\n`);
            console.log(`Sent TCP sample for ${sourceId}: ${lines.length} lines`);
            socket.end();
          });

          socket.once('close', () => resolve());
          socket.once('error', (error) => reject(error));
        }),
    ),
  );
};

const run = async () => {
  if (mode === 'udp') {
    await sendUdp();
    return;
  }

  await sendTcp();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
