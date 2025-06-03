(async function() {
    // ========== 初始化依赖加载 ==========
    try {
        if (!window.JSZip) {
            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            document.head.appendChild(script1);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        if (!window.XLSX) {
            const script2 = document.createElement('script');
            script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            document.head.appendChild(script2);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (e) {
        console.error('依赖加载失败:', e);
        return;
    }

    // ========== 用户文件选择 ==========
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(input);

    let excelHeaders = [], excelMap = new Map();
    try {
        const { headers, data } = await new Promise(resolve => {
            input.onchange = async e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = e => {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    resolve({
                        headers: jsonData[0] || [],
                        data: jsonData.slice(1)
                    });
                };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        });

        // 处理空列名
        excelHeaders = headers.map((header, idx) => header || `Unnamed: ${idx}`);
        data.forEach(row => {
            const key = `${String(row[0]||'').trim()}|${String(row[1]||'').replace(/\s/g, '')}`;
            excelMap.set(key, row);
        });
        console.log('Excel文件加载成功，总记录数:', data.length);
    } catch (e) {
        console.error('Excel处理失败:', e);
        return;
    }

    // ========== 配置区 ==========
    const CONFIG = {
        DELAY_BASE: 2500,       // 基础延迟
        DELAY_RANDOM: 1000,     // 随机延迟范围
        MAX_RETRY: 5,           // 最大重试次数
        PAGE_SIZE: 500,         // 每页显示数量
        ZIP_PREFIX: 'FinalData' // 压缩包名前缀
    };

    // ========== 核心数据提取函数 ==========
    const extractRowData = row => {
        const baseData = {
            债券资产包: (row.querySelector('.el-table_2_column_8 span')?.innerText || '').trim(),
            姓名: (row.querySelector('.el-table_2_column_14 span')?.innerText || '').trim(),
            身份证号: (row.querySelector('.el-table_2_column_15 span')?.innerText || '').replace(/[,\s]/g, ''),
            总代还本金: (row.querySelector('.el-table_2_column_16 span')?.innerText || '').replace(/[^\d.]/g, ''),
            总债转金额: (row.querySelector('.el-table_2_column_17 span')?.innerText || '').replace(/[^\d.]/g, ''),
            业务员: (row.querySelector('.el-table_2_column_19 span')?.innerText || '未分配').trim()
        };

        const excelKey = `${baseData.姓名}|${baseData.身份证号}`;
        const excelRow = excelMap.get(excelKey) || [];

        // 确保Excel数据完整拼接到baseData中
        const mergedData = { ...baseData };
        excelHeaders.slice(2).forEach((header, idx) => {
            mergedData[header] = excelRow[idx + 2] ?? '';
        });

        return mergedData;
    };

    // ========== 修复分页计算逻辑 ==========
    const calculateTotalPages = () => {
        const totalText = document.querySelector('.el-pagination__total')?.innerText || '';
        const totalMatch = totalText.match(/\d+/);
        const total = totalMatch ? parseInt(totalMatch[0], 10) : 0;
        return Math.ceil(total / CONFIG.PAGE_SIZE) || 1;
    };

    // ========== 分页控制逻辑 ==========
    const gotoNextPage = async () => {
        const nextBtn = document.querySelector('.btn-next:not([disabled])');
        if (!nextBtn) return false;
        
        nextBtn.click();
        await new Promise(r => setTimeout(r, 500));
        return true;
    };

    // ========== 文件生成逻辑 ==========
    const generateZip = async data => {
        const zip = new JSZip();
        const salesMap = data.reduce((map, item) => {
            const key = item.业务员.replace(/[/\\?%*:|"<>]/g, '_');
            (map[key] = map[key] || []).push(item);
            return map;
        }, {});

        const headers = [
            '债券资产包', '姓名', '身份证号', '总代还本金', '总债转金额',
            ...excelHeaders.slice(2)
        ];

        Object.entries(salesMap).forEach(([salesman, items]) => {
            const content = [
                '\uFEFF' + headers.join(','),
                ...items.map(item => 
                    headers.map(field => {
                        const val = item[field];
                        return typeof val === 'string' 
                            ? `"${val.replace(/"/g, '""')}"` 
                            : (val ?? '');
                    }).join(',')
                )
            ].join('\n');
            zip.file(`${salesman}.csv`, content);
        });

        const blob = await zip.generateAsync({type: "blob"});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${CONFIG.ZIP_PREFIX}_${new Date().toISOString().slice(0,10)}.zip`;
        link.click();
        
        return salesMap;
    };

    // ========== 主执行流程 ==========
    console.log('=== 爬虫启动 ===');
    const startTime = Date.now();
    let allData = [];
    let currentPage = 1;
    const totalPages = calculateTotalPages();

    while (currentPage <= totalPages) {
        let retry = 0;
        let success = false;

        while (retry < CONFIG.MAX_RETRY) {
            try {
                console.log(`[第 ${currentPage}/${totalPages} 页]`);
                
                await new Promise(r => setTimeout(r, 800));
                await waitForElement('.el-table__row', 15000);

                const rows = Array.from(document.querySelectorAll('tr.el-table__row'));
                if (rows.length === 0) throw new Error('未找到数据行');
                
                const pageData = rows.map(extractRowData).filter(d => d.姓名 && d.身份证号);
                allData = allData.concat(pageData);
                console.log(`√ 已获取 ${pageData.length} 条，累计 ${allData.length}`);

                success = await gotoNextPage();
                if (!success) {
                    currentPage = Infinity;
                } else {
                    const delay = CONFIG.DELAY_BASE + Math.random() * CONFIG.DELAY_RANDOM;
                    await new Promise(r => setTimeout(r, delay));
                    currentPage++;
                }
                break;
            } catch (e) {
                console.warn(`× 错误: ${e.message}`);
                if (++retry >= CONFIG.MAX_RETRY) currentPage++;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // ========== 最终处理 ==========
    if (allData.length > 0) {
        console.log('=== 正在生成压缩包 ===');
        const salesData = await generateZip(allData);
        const matchCount = allData.filter(d => excelMap.has(`${d.姓名}|${d.身份证号}`)).length;
        
        console.log(`\n=== 执行结果 ===
总记录数: ${allData.length}
成功匹配: ${matchCount} (${(matchCount/allData.length*100).toFixed(1)}%)
生成文件: ${Object.keys(salesData).length} 个业务员文件
总耗时: ${((Date.now()-startTime)/1000).toFixed(1)} 秒\n`);
    } else {
        console.warn('=== 无有效数据可导出 ===');
    }

    // ========== 工具函数 ==========
    function waitForElement(selector, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (document.querySelector(selector)) {
                    resolve();
                } else if (Date.now() - start > timeout) {
                    reject(new Error(`元素加载超时: ${selector}`));
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }
})();
