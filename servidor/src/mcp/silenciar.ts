// En stdio, stdout es solo para los mensajes JSON-RPC: cualquier console.log
// rompería el protocolo. Este módulo se importa primero y manda todo a stderr.
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
console.debug = (...args: unknown[]) => console.error(...args)
