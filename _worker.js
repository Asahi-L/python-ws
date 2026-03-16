export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const workerHostname = url.hostname; 

        // ==========================================
        // 1. 核心安全配置 (请务必自己修改这些值)
        // ==========================================
        const targetDomains =['']; // 你的真实后端域名
        const targetHostname = targetDomains[Math.floor(Math.random() * targetDomains.length)];
        
        // 密钥 1: 你的 WebSocket 节点路径
        const SECRET_WS_PATH = ''; 
        
        // 密钥 2: 你的订阅专用路径 (不要用常见的名字)
        const SECRET_SUB_PATH = ''; 
        
        // 密钥 3: 订阅专属的 Token 密码 (只有带上这个密码，才允许下载订阅)
        const SUB_TOKEN = ''; 

        // ==========================================
        // 2. 边缘终极防御 (真正的铁壁，斩断一切非法探测)
        // ==========================================
        const upgradeHeader = request.headers.get('Upgrade') || '';
        const isWebSocket = upgradeHeader.toLowerCase() === 'websocket';

        // 🛡️ 防御场景 A：WebSocket 节点保护
        if (url.pathname === SECRET_WS_PATH) {
            if (!isWebSocket) {
                // 浏览器直接访问 WS 路径 -> 返回 404，抹杀 "No WebSocket UPGRADE" 报错指纹
                return new Response('404 Not Found', { status: 404 });
            }
        } else if (isWebSocket) {
            // 访问的不是 WS 路径，却试图发起 WS 握手 (恶意扫描器) -> 斩断
            return new Response('404 Not Found', { status: 404 });
        }

        // 🛡️ 防御场景 B：订阅路径的 Token 密钥保护
        if (url.pathname.startsWith(SECRET_SUB_PATH)) {
            const providedToken = url.searchParams.get('token');
            if (providedToken !== SUB_TOKEN) {
                // 哪怕路径蒙对了，只要没带正确的 ?token=密码，统统伪装成 404 页面！
                return new Response('404 Not Found', { status: 404 });
            }
        }

        // ==========================================
        // 3. 构建请求并发往后端
        // ==========================================
        url.protocol = 'https:';
        url.hostname = targetHostname;

        const newRequest = new Request(url, request);
        newRequest.headers.set('Host', targetHostname);
        
        // 防盗链重写
        if (request.headers.has('Origin')) {
            newRequest.headers.set('Origin', `https://${targetHostname}`);
        }
        if (request.headers.has('Referer')) {
            try {
                const refUrl = new URL(request.headers.get('Referer'));
                refUrl.hostname = targetHostname;
                refUrl.protocol = 'https:';
                newRequest.headers.set('Referer', refUrl.toString());
            } catch (e) {
                newRequest.headers.set('Referer', `https://${targetHostname}`);
            }
        }

        // ==========================================
        // 4. 发起请求并处理响应 (抹除真实指纹)
        // ==========================================
        try {
            let response = await fetch(newRequest);
            let newResponse = new Response(response.body, response);

            newResponse.headers.delete('X-Powered-By');
            newResponse.headers.delete('Server');
            newResponse.headers.set('Server', 'cloudflare'); 
            
            // 【极其重要】禁止搜索引擎抓取，防止订阅内容或伪装主页被 Google 索引收录
            newResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');

            // 5. 替换 HTML 中的真实域名防泄露
            const contentType = newResponse.headers.get('Content-Type') || '';
            if (contentType.includes('text/html')) {
                return new HTMLRewriter()
                    .on('*', new AttributeRewriter(targetHostname, workerHostname))
                    .transform(newResponse);
            }

            return newResponse;

        } catch (error) {
            // 6. 后端宕机时的高仿 Cloudflare 错误页
            const fakeErrorHTML = `
            <!DOCTYPE html>
            <html lang="en">
            <head><title>502 Bad Gateway</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 10%;">
                <h1>502 Bad Gateway</h1>
                <p>cloudflare</p>
            </body>
            </html>`;
            return new Response(fakeErrorHTML, { 
                status: 502,
                headers: { 
                    'Content-Type': 'text/html;charset=UTF-8',
                    'Server': 'cloudflare'
                }
            });
        }
    }
};

class AttributeRewriter {
    constructor(targetHostname, workerHostname) {
        this.target = targetHostname;
        this.worker = workerHostname;
    }
    element(element) {
        const attributesToRewrite =['href', 'src', 'action', 'content'];
        for (const attr of attributesToRewrite) {
            if (element.hasAttribute(attr)) {
                let val = element.getAttribute(attr);
                if (val.includes(this.target)) {
                    element.setAttribute(attr, val.replace(new RegExp(this.target, 'g'), this.worker));
                }
            }
        }
    }
}