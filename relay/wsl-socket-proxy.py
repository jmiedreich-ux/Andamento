import asyncio

SOCKET_PATH = "/home/jeremy/.codex/app-server-control/app-server-control.sock"
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 47822


async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def handle_client(client_reader, client_writer):
    try:
        server_reader, server_writer = await asyncio.open_unix_connection(SOCKET_PATH)
        await asyncio.gather(
            pipe(client_reader, server_writer),
            pipe(server_reader, client_writer),
        )
    except Exception:
        client_writer.close()
        await client_writer.wait_closed()


async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
