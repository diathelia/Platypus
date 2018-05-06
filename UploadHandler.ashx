<%@ WebHandler Language="C#" Class="UploadHandler" %>

using System;
using System.IO;
using System.Web;

public class UploadHandler : IHttpHandler
{
	private string jsonResponseFormat = @"{{ ""mediaid"": ""{0}"", ""filename"": ""{1}"", ""extension"": ""{2}"", ""success"": {3}, ""status"": ""{4}"" }}";

	public void ProcessRequest(HttpContext context)
	{
		string filename = "";
		string mediaid = Guid.NewGuid().ToString();

		try
		{
			if (!string.IsNullOrEmpty(context.Request.Files[0].FileName))
			{
				filename = context.Request.Files[0].FileName;
			}

			string fileExt = System.IO.Path.GetExtension(filename).ToLower();

			string outputFileName = context.Server.MapPath("~/incoming/" + filename);
			Stream inputStream = context.Request.Files[0].InputStream;

			using (FileStream fs = File.Open(outputFileName, FileMode.Create))
			{
				SaveFile(inputStream, fs);
				fs.Close();
			}

			string result = string.Format(jsonResponseFormat, mediaid, filename, fileExt, "true", "recved");

			context.Response.ContentType = "text/plain";
			context.Response.Write(result);
		}
		catch (Exception ex)
		{
			//context.Response.Status = "Error uploading";
			context.Response.StatusCode = 500;
			context.Response.ContentType = "text/plain";
			context.Response.Write(string.Format(jsonResponseFormat, Guid.Empty.ToString(), "", "", "false", ex.Message));
		}
	}

	private void SaveFile(Stream stream, FileStream fs)
	{
		byte[] buffer = new byte[4096];
		int bytesRead;
		while ((bytesRead = stream.Read(buffer, 0, buffer.Length)) != 0)
		{
			fs.Write(buffer, 0, bytesRead);
			//totalBytes += bytesRead;
		}
	}

	public bool IsReusable
	{
		get
		{
			return false;
		}
	}

}