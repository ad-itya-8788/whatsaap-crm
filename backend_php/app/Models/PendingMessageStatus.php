<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class PendingMessageStatus extends Model {
    protected $fillable = ['wamid','status','error_code','error_title','error_details','status_at'];
    protected $casts = ['status_at'=>'datetime'];
}
