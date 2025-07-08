// == 完整爬虫方案（动态页数版）==
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
        alert('依赖加载失败，请刷新页面重试');
        return;
    }

    // ========== 用户文件选择 ==========
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let excelData = [], excelHeaders = [], excelMap = new Map();
    try {
        const { headers, data } = await new Promise(resolve => {
            input.onchange = async function(e) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                        const sheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                        resolve({
                            headers: jsonData[0] || [],
                            data: jsonData.slice(1).filter(row => row.length > 0)
                        });
                    } catch (error) {
                        alert('Excel解析错误，请检查文件格式');
                        resolve({ headers: [], data: [] });
                    }
                };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        });

        excelData = data;
        excelHeaders = headers.map((h, i) => h || '列' + (i + 1));
        
        // 使用姓名+证件号数字作为匹配键
        const uniqueSet = new Set();
        data.forEach(row => {
            if (row.length < 2) return;
            
            const name = String(row[0] || '').trim();
            const id = String(row[1] || '').replace(/\D/g, '');
            
            if (name && id) {
                const key = `${name}|${id}`;
                if (!uniqueSet.has(key)) {
                    uniqueSet.add(key);
                    excelMap.set(key, row);
                }
            }
        });
    } catch (e) {
        alert('Excel处理失败，请重试');
        return;
    } finally {
        if (input.parentNode) {
            document.body.removeChild(input);
        }
    }

    // ========== 页数计算函数 ==========
    function calculateTotalPages() {
        const totalText = document.querySelector('.el-pagination__total')?.innerText || 
                         document.querySelector('.pagination-total')?.innerText ||
                         '0';
        const totalMatch = totalText.match(/[\d,]+/);
        const total = totalMatch ? parseInt(totalMatch[0].replace(/,/g, '')) : 0;
        return Math.ceil(total / CONFIG.PAGE_SIZE);
    }

    // ========== 配置区 ==========
    const CONFIG = {
    DELAY: 2000,            // 翻页延迟(毫秒)
    ZIP_PREFIX: '业务员数据', // 压缩包前缀
    PAGE_SIZE: 500,         // 每页显示数量（用于计算总页数）
    // 修改为表头名称映射（不再使用固定列号）
    COLUMN_NAMES: ['姓名', '证件号', 'CPE'] // 需要匹配的表头名称
    };

// ========== 数据提取函数 ==========
    function extractRowData(row) {
    // 获取表头行，动态建立列名到class的映射
    const headerRow = document.querySelector('thead tr');
    if (!headerRow) return null;
    
    // 建立列名到class的映射
    const columnMap = {};
    headerRow.querySelectorAll('th').forEach(th => {
        const colName = th.textContent.trim();
        if (CONFIG.COLUMN_NAMES.includes(colName)) {
            // 获取对应的class（通常是el-table_*_column_*）
            const classList = Array.from(th.classList).find(cls => 
                cls.startsWith('el-table_') && cls.includes('column_')
            );
            if (classList) {
                columnMap[colName] = classList;
            }
        }
    });

    // 获取单元格值
    function getCellValue(colName) {
        const className = columnMap[colName];
        if (!className) return '';
        
        const cell = row.querySelector(`td.${className} .cell`);
        return cell ? cell.textContent.trim() : '';
    }

    const name = getCellValue('姓名');
    const id = getCellValue('证件号').replace(/\D/g, '');
    const salesman = getCellValue('CPE') || '未分配';

    if (!name || !id) return null;

    const key = `${name}|${id}`;
    return {
        webData: { name, id, salesman },
        excelRow: excelMap.get(key)
    };
    }



    // ========== 翻页抓取函数 ==========
    async function fetchAllPages() {
        const allRows = [];
        let currentPage = 1;
        const totalPages = calculateTotalPages();
        
        console.log(`📊 总页数: ${totalPages} (每页 ${CONFIG.PAGE_SIZE} 条)`);
        
        while (currentPage <= totalPages) {
            console.log(`⏳ 正在采集第 ${currentPage}/${totalPages} 页数据...`);
            
            // 1. 获取当前页数据
            const rows = Array.from(document.querySelectorAll('tr.el-table__row'));
            const pageData = rows.map(row => extractRowData(row)).filter(Boolean);
            allRows.push(...pageData);
            
            // 2. 下一页按钮检测
            const nextBtn = document.querySelector('.btn-next');
            const isLastPage = nextBtn && nextBtn.hasAttribute('disabled');
            
            if (isLastPage) {
                console.log('🛑 已到达最后一页');
                break;
            }
            
            // 3. 执行翻页
            currentPage++;
            nextBtn.click();
            await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY));
        }
        
        console.log(`✅ 采集完成，共处理 ${currentPage} 页，获得 ${allRows.length} 条数据`);
        return allRows;
    }

    // ========== 文件生成函数 ==========
    async function generateZip(data) {
        return new Promise(async (resolve) => {
            console.log('🗜️ 开始生成压缩文件...');
            const zip = new JSZip();
            const salesMap = new Map();
            const uniqueKeys = new Set();

            // 1. 数据去重处理
            data.forEach(item => {
                if (!item.excelRow) return;
                
                const key = `${item.webData.name}|${item.webData.id}`;
                if (uniqueKeys.has(key)) return;
                uniqueKeys.add(key);
                
                const salesman = item.webData.salesman.replace(/[/\\?%*:|"<>]/g, '_');
                if (!salesMap.has(salesman)) {
                    salesMap.set(salesman, []);
                }
                salesMap.get(salesman).push(item.excelRow);
            });

            // 2. 生成CSV文件
            salesMap.forEach((rows, salesman) => {
                const headerRow = '\uFEFF' + excelHeaders.join(',');
                const dataRows = rows.map(row => 
                    row.map(cell => 
                        typeof cell === 'string' ? `"${cell.replace(/"/g, '""')}"` : (cell ?? '')
                    ).join(',')
                ).join('\n');
                
                zip.file(`${salesman}.csv`, headerRow + '\n' + dataRows);
                console.log(`📄 生成文件: ${salesman}.csv (${rows.length}条)`);
            });

            // 3. 下载ZIP
            const blob = await zip.generateAsync({type: "blob"});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${CONFIG.ZIP_PREFIX}_${new Date().toLocaleDateString('zh-CN')}.zip`;
            document.body.appendChild(link);
            link.click();
            
            // 4. 清理资源
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                console.log('🧹 临时资源已清理');
                resolve();
            }, 100);
        });
    }

    // ========== 主执行流程 ==========
    try {
        console.log('🚀 启动数据采集任务');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const matchedData = await fetchAllPages();
        
        if (matchedData.length > 0) {
            await generateZip(matchedData);
            console.log('🎉 文件生成完成');
            alert('✅ 数据文件已生成并下载\n任务终止运行');
        } else {
            console.log('⚠️ 无匹配数据');
            alert('⚠️ 未找到匹配数据\n任务终止运行');
        }
    } catch (e) {
        console.error('❌ 处理失败:', e);
        alert(`❌ 处理失败: ${e.message}\n任务终止运行`);
    } finally {
        console.log('🔚 程序执行结束');
    }
})();
