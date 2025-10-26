const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const csv = require('csv-parser');

// Ne pas déstructurer processRowFunc pour pouvoir l'utiliser
const filePath = workerData.filePath;
const tableName = workerData.tableName;
const processRow = workerData.processRowFunc;

let count = 0;
const batch = [];
const BATCH_SIZE = 50000;

fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
        // Convertir la fonction string en fonction exécutable
        let processedRow;
        try {
            if (typeof processRow === 'function') {
                processedRow = processRow(row);
            } else {
                // Si la fonction ne peut pas être sérialisée, retransformer
                processedRow = processRow(row);
            }
            
            if (processedRow) {
                batch.push(processedRow);
                
                if (batch.length >= BATCH_SIZE) {
                    parentPort.postMessage({
                        type: 'batch',
                        data: batch.slice(),
                        tableName
                    });
                    count += batch.length;
                    batch.length = 0;
                }
            }
        } catch (error) {
            // Ignorer les erreurs de traitement
        }
    })
    .on('end', () => {
        if (batch.length > 0) {
            parentPort.postMessage({
                type: 'batch',
                data: batch,
                tableName
            });
            count += batch.length;
        }
        
        parentPort.postMessage({
            type: 'done',
            count,
            tableName
        });
    })
    .on('error', (error) => {
        parentPort.postMessage({
            type: 'error',
            error: error.message,
            tableName
        });
    });

